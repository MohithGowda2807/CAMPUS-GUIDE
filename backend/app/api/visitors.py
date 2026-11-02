from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.app.auth.security import get_optional_user, require_roles
from backend.app.config.database import get_db_connection
from backend.app.schemas.domain import (
    GateActionRequest,
    VisitPassReceiptOut,
    VisitorRegistrationRequest,
)

router = APIRouter(prefix="/visits", tags=["Visitor Registration & Gate Management"])


def _row_to_dict(row: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in dict(row).items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif hasattr(v, "__float__") and not isinstance(v, (int, float, bool)):
            out[k] = float(v)
        else:
            out[k] = v
    return out


def _execute_visitor_registration(
    conn: Connection,
    payload: VisitorRegistrationRequest,
    actor_user_id: int | None,
    allow_immediate_checkin: bool,
) -> VisitPassReceiptOut:
    campus_id = conn.execute(
        text("SELECT campus_id FROM campuses WHERE status = 'ACTIVE' ORDER BY campus_id ASC LIMIT 1")
    ).scalar()
    if not campus_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Active campus configuration is not initialized.",
        )

    conn.execute(
        text(
            """
            CALL sp_register_visitor_pass(
                :full_name, :phone, :email, :org, :cid, :bid, :rid, :hid,
                :purpose, :gate, :req_approval, :actor_uid,
                @out_visit_id, @out_pass_code
            )
            """
        ),
        {
            "full_name": payload.full_name,
            "phone": payload.contact_phone,
            "email": str(payload.contact_email) if payload.contact_email else None,
            "org": payload.organization,
            "cid": campus_id,
            "bid": payload.destination_building_id,
            "rid": payload.destination_room_id,
            "hid": payload.host_staff_id,
            "purpose": payload.purpose,
            "gate": payload.gate_name,
            "req_approval": payload.requires_host_approval,
            "actor_uid": actor_user_id,
        },
    )
    out_vars = conn.execute(text("SELECT @out_visit_id AS visit_id, @out_pass_code AS pass_code")).mappings().first()
    visit_id = int(out_vars["visit_id"])

    if allow_immediate_checkin and payload.immediate_check_in and not payload.requires_host_approval:
        conn.execute(
            text("CALL sp_record_gate_action(:vid, 'CHECK_IN', :uid, :gate)"),
            {"vid": visit_id, "uid": actor_user_id, "gate": payload.gate_name},
        )

    conn.commit()

    receipt = conn.execute(
        text(
            """
            SELECT visit_id, visit_pass_code, visitor_name, purpose, gate_name,
                   approval_status, visit_status, destination_building_name,
                   destination_room_number, host_name, scheduled_at AS created_at
            FROM vw_security_visitor_board
            WHERE visit_id = :vid
            """
        ),
        {"vid": visit_id},
    ).mappings().first()

    return VisitPassReceiptOut(**dict(receipt))


@router.post("/pre-register", response_model=VisitPassReceiptOut, status_code=status.HTTP_201_CREATED)
def public_visitor_preregistration(
    payload: VisitorRegistrationRequest,
    optional_user: dict[str, Any] | None = Depends(get_optional_user),
    conn: Connection = Depends(get_db_connection),
) -> VisitPassReceiptOut:
    """
    Write-only visitor pre-registration endpoint for prospective visitors/kiosks.
    Returns strictly the caller's newly issued pass code — never exposes any existing visitor records.
    """
    actor_id = optional_user["user_id"] if optional_user else None
    return _execute_visitor_registration(conn, payload, actor_id, allow_immediate_checkin=False)


@router.post("", response_model=VisitPassReceiptOut, status_code=status.HTTP_201_CREATED)
def security_desk_register_visitor(
    payload: VisitorRegistrationRequest,
    current_user: dict[str, Any] = Depends(require_roles("SECURITY_RECEPTION", "FACILITY_ADMIN", "SYSTEM_ADMIN")),
    conn: Connection = Depends(get_db_connection),
) -> VisitPassReceiptOut:
    return _execute_visitor_registration(
        conn,
        payload,
        actor_user_id=current_user["user_id"],
        allow_immediate_checkin=True,
    )


@router.get("")
def list_authorised_visitor_records(
    visit_status: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict[str, Any] = Depends(
        require_roles("SECURITY_RECEPTION", "FACULTY_STAFF", "FACILITY_ADMIN", "SYSTEM_ADMIN")
    ),
    conn: Connection = Depends(get_db_connection),
) -> list[dict[str, Any]]:
    user_roles = set(current_user["roles"])
    clauses = ["1=1"]
    params: dict[str, Any] = {"lim": limit}

    # Faculty without Security/Admin role only see visits where they are the designated host
    if not user_roles.intersection({"SECURITY_RECEPTION", "FACILITY_ADMIN", "SYSTEM_ADMIN"}):
        if not current_user.get("linked_staff_id"):
            return []
        clauses.append("host_staff_id = :hsid")
        params["hsid"] = current_user["linked_staff_id"]

    if visit_status:
        clauses.append("visit_status = :vst")
        params["vst"] = visit_status

    if q and q.strip():
        clauses.append(
            "(visitor_name LIKE :lk OR visit_pass_code LIKE :lk OR contact_phone LIKE :lk OR destination_building_name LIKE :lk)"
        )
        params["lk"] = f"%{q.strip()}%"

    rows = conn.execute(
        text(
            f"""
            SELECT *
            FROM vw_security_visitor_board
            WHERE {' AND '.join(clauses)}
            ORDER BY scheduled_at DESC, visit_id DESC
            LIMIT :lim
            """
        ),
        params,
    ).mappings().all()

    return [_row_to_dict(r) for r in rows]


@router.post("/{visit_id}/action")
def record_visit_checkpoint_action(
    visit_id: int,
    payload: GateActionRequest,
    current_user: dict[str, Any] = Depends(
        require_roles("SECURITY_RECEPTION", "FACULTY_STAFF", "FACILITY_ADMIN", "SYSTEM_ADMIN")
    ),
    conn: Connection = Depends(get_db_connection),
) -> dict[str, Any]:
    visit = conn.execute(
        text("SELECT visit_id, host_staff_id FROM visitor_logs WHERE visit_id = :vid"),
        {"vid": visit_id},
    ).mappings().first()
    if not visit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Visit record not found.")

    user_roles = set(current_user["roles"])
    if payload.action in ("CHECK_IN", "CHECK_OUT"):
        if not user_roles.intersection({"SECURITY_RECEPTION", "SYSTEM_ADMIN"}):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Security/Reception personnel may record gate check-in or check-out.",
            )
    elif payload.action in ("APPROVE_HOST", "REJECT_HOST"):
        is_admin_or_sec = bool(user_roles.intersection({"SECURITY_RECEPTION", "SYSTEM_ADMIN"}))
        is_linked_host = visit["host_staff_id"] and visit["host_staff_id"] == current_user.get("linked_staff_id")
        if not (is_admin_or_sec or is_linked_host):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the designated host or authorised staff may approve/reject this visit.",
            )

    try:
        conn.execute(
            text("CALL sp_record_gate_action(:vid, :act, :uid, :gate)"),
            {
                "vid": visit_id,
                "act": payload.action,
                "uid": current_user["user_id"],
                "gate": payload.gate_name,
            },
        )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    updated = conn.execute(
        text("SELECT * FROM vw_security_visitor_board WHERE visit_id = :vid"),
        {"vid": visit_id},
    ).mappings().first()
    return _row_to_dict(updated)
