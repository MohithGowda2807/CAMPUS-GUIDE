from __future__ import annotations

"""
RVCE Smart Campus Assistant — Hybrid RAG (Retrieval-Augmented Generation) & Semantic NLP Engine.

Architecture:
1. Live Knowledge Corpus Builder:
   Synthesizes rich semantic documents from MySQL (buildings, floors, rooms, faculty,
   departments, facilities) and MongoDB (indoor floor layouts & pathway network).
2. Multi-Retriever Reciprocal Rank Fusion (RRF):
   - Lexical Retriever: Okapi BM25 (`rank_bm25.BM25Okapi`) over tokenized corpus documents.
   - Dense/Subword Vector Retriever: TF-IDF Word + Character N-Gram (3..5) Cosine Similarity
     (`sklearn.feature_extraction.text.TfidfVectorizer`) for typo-tolerant semantic retrieval.
   - Fuzzy Phonetic Entity Matcher: `rapidfuzz` (`WRatio` & `token_set_ratio`) over faculty
     names, room codes, building names, and facility titles.
3. Multi-Turn Conversational Context & Slot Resolution:
   Resolves follow-up questions ("Who else sits in that room?", "How do I walk there?",
   "What floor is she on?") using conversation history context.
4. Grounded Response & Action Card Synthesizer:
   Produces clean, natural user-facing responses with embedded interactive navigation cards
   (Faculty cards, Indoor Cabin Floor Plan cards, Turn-by-Turn Route cards, Facility cards).
"""

from dataclasses import dataclass, field
import re
import time
from typing import Any

import numpy as np
from rank_bm25 import BM25Okapi
from rapidfuzz import fuzz, process
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import text
from sqlalchemy.engine import Connection

from backend.app.services.routing import compute_campus_route


_QUERY_STOP_WORDS = {
    "where", "who", "what", "which", "when", "how", "is", "are", "was", "were",
    "does", "do", "can", "could", "would", "should", "sit", "sits", "sitting",
    "seated", "cabin", "office", "Location", "location", "locate", "find",
    "show", "tell", "me", "about", "the", "a", "an", "in", "at", "on", "of",
    "for", "to", "from", "with", "professor", "prof", "faculty", "teacher",
    "maam", "mam", "sir", "dr", "mr", "ms", "mrs", "please", "pls", "rvce",
}


def _extract_entity_focus(query_str: str) -> str:
    cleaned = re.sub(r"[^a-z0-9\s\-]", " ", query_str.lower())
    words = [w for w in cleaned.split() if w not in _QUERY_STOP_WORDS and len(w) > 1]
    return " ".join(words).strip() or query_str.strip().lower()


def _clean_text(val: Any) -> str:
    if val is None:
        return ""
    return str(val).strip()


def _tokenize(text_str: str) -> list[str]:
    cleaned = re.sub(r"[^a-z0-9\s\-]", " ", text_str.lower())
    tokens = [t for t in re.split(r"[\s\-]+", cleaned) if len(t) > 1]
    return tokens or ["rvce"]


@dataclass
class KnowledgeDoc:
    doc_id: str
    entity_type: str  # FACULTY | ROOM | BUILDING | DEPARTMENT | FACILITY | FAQ
    entity_id: int
    title: str
    aliases: list[str]
    search_text: str
    metadata: dict[str, Any] = field(default_factory=dict)


class CampusRagIndex:
    def __init__(self) -> None:
        self.docs: list[KnowledgeDoc] = []
        self.built_at: float = 0.0
        self.bm25: BM25Okapi | None = None
        self.word_vectorizer: TfidfVectorizer | None = None
        self.char_vectorizer: TfidfVectorizer | None = None
        self.word_matrix: Any = None
        self.char_matrix: Any = None

        # Lookup maps for fast multi-hop joins
        self.faculty_by_id: dict[int, dict[str, Any]] = {}
        self.rooms_by_id: dict[int, dict[str, Any]] = {}
        self.rooms_by_code: dict[str, dict[str, Any]] = {}
        self.buildings_by_id: dict[int, dict[str, Any]] = {}
        self.buildings_by_code: dict[str, dict[str, Any]] = {}
        self.departments_by_code: dict[str, dict[str, Any]] = {}
        self.facilities_by_id: dict[int, dict[str, Any]] = {}
        self.occupants_by_room_id: dict[int, list[dict[str, Any]]] = {}

    def is_fresh(self, ttl_seconds: float = 120.0) -> bool:
        return bool(self.docs) and (time.time() - self.built_at) < ttl_seconds

    def build_from_db(self, conn: Connection) -> None:
        docs: list[KnowledgeDoc] = []
        self.faculty_by_id.clear()
        self.rooms_by_id.clear()
        self.rooms_by_code.clear()
        self.buildings_by_id.clear()
        self.buildings_by_code.clear()
        self.departments_by_code.clear()
        self.facilities_by_id.clear()
        self.occupants_by_room_id.clear()

        # 1. Buildings
        b_rows = conn.execute(
            text("SELECT * FROM vw_public_building_directory ORDER BY building_id ASC")
        ).mappings().all()
        for b in b_rows:
            bd = dict(b)
            bd["latitude"] = float(bd["latitude"])
            bd["longitude"] = float(bd["longitude"])
            self.buildings_by_id[bd["building_id"]] = bd
            self.buildings_by_code[bd["building_code"].upper()] = bd

        # 2. Departments
        d_rows = conn.execute(
            text("SELECT * FROM vw_department_directory ORDER BY dept_id ASC")
        ).mappings().all()
        for d in d_rows:
            dd = dict(d)
            self.departments_by_code[dd["dept_code"].upper()] = dd

        # 3. Rooms
        r_rows = conn.execute(
            text("SELECT * FROM vw_public_room_directory ORDER BY room_id ASC")
        ).mappings().all()
        for r in r_rows:
            rd = dict(r)
            if rd.get("building_latitude") is not None:
                rd["building_latitude"] = float(rd["building_latitude"])
            if rd.get("building_longitude") is not None:
                rd["building_longitude"] = float(rd["building_longitude"])
            self.rooms_by_id[rd["room_id"]] = rd
            self.rooms_by_code[rd["room_number"].upper()] = rd

        # 4. Faculty
        f_rows = conn.execute(
            text("SELECT * FROM vw_public_faculty_directory ORDER BY cadre_rank ASC, display_name ASC")
        ).mappings().all()
        for f in f_rows:
            fd = dict(f)
            if fd.get("building_latitude") is not None:
                fd["building_latitude"] = float(fd["building_latitude"])
            if fd.get("building_longitude") is not None:
                fd["building_longitude"] = float(fd["building_longitude"])
            self.faculty_by_id[fd["staff_id"]] = fd
            rid = fd.get("office_room_id")
            if rid:
                self.occupants_by_room_id.setdefault(int(rid), []).append(fd)

        # 5. Facilities
        fc_rows = conn.execute(
            text(
                """
                SELECT fc.facility_id, fc.facility_name, fc.category, fc.description,
                       fc.building_id, b.building_code, b.building_name,
                       fc.floor_id, fl.floor_name, fc.room_id, r.room_number,
                       COALESCE(fc.latitude, b.latitude) AS latitude,
                       COALESCE(fc.longitude, b.longitude) AS longitude,
                       fc.opening_hours, fc.is_accessible, fc.verification_status
                FROM facilities fc
                LEFT JOIN buildings b ON b.building_id = fc.building_id
                LEFT JOIN floors fl ON fl.floor_id = fc.floor_id
                LEFT JOIN rooms r ON r.room_id = fc.room_id
                WHERE fc.public_visibility = TRUE AND fc.status = 'ACTIVE'
                ORDER BY fc.facility_id ASC
                """
            )
        ).mappings().all()
        for fc in fc_rows:
            fcd = dict(fc)
            if fcd.get("latitude") is not None:
                fcd["latitude"] = float(fcd["latitude"])
            if fcd.get("longitude") is not None:
                fcd["longitude"] = float(fcd["longitude"])
            self.facilities_by_id[fcd["facility_id"]] = fcd

        # Build Semantic Documents for Faculty
        for sid, fd in self.faculty_by_id.items():
            name_no_title = re.sub(r"^(dr\.?|mr\.?|ms\.?|prof\.?)\s+", "", fd["display_name"], flags=re.I).strip()
            room_num = _clean_text(fd.get("office_room_number"))
            room_name = _clean_text(fd.get("office_room_name"))
            floor_name = _clean_text(fd.get("floor_name"))
            bldg_name = _clean_text(fd.get("building_name"))
            prog = _clean_text(fd.get("program_name"))
            role = _clean_text(fd.get("leadership_role"))

            aliases = [fd["display_name"], name_no_title, fd["employee_code"]]
            if room_num:
                aliases.append(room_num)
            if "kannada" in prog.lower():
                aliases.extend(["Kannada faculty", "Kannada teacher", "Kannada department"])
            if role:
                aliases.extend([role, f"{role} {fd['dept_code']}", f"{role} {fd['dept_name']}"])

            search_blob = (
                f"{fd['display_name']} {name_no_title} staff id {sid} employee {fd['employee_code']} "
                f"{fd['designation']} {role} {fd['dept_code']} {fd['dept_name']} {prog} "
                f"cabin room {room_num} {room_name} {floor_name} {bldg_name} "
                f"availability {fd.get('effective_availability', 'UNKNOWN')}"
            )
            docs.append(
                KnowledgeDoc(
                    doc_id=f"FACULTY:{sid}",
                    entity_type="FACULTY",
                    entity_id=sid,
                    title=fd["display_name"],
                    aliases=aliases,
                    search_text=search_blob,
                    metadata=fd,
                )
            )

        # Build Semantic Documents for Rooms / Labs / Cabins
        for rid, rd in self.rooms_by_id.items():
            occs = self.occupants_by_room_id.get(rid, [])
            occ_names = ", ".join(o["display_name"] for o in occs)
            rnum = rd["room_number"]
            rnum_compact = rnum.replace("-", " ")
            aliases = [rnum, rnum_compact, rd["room_name"]]
            if "101" in rnum:
                aliases.extend(["Counselling room", "EEE counselling cabin"])
            if "104" in rnum:
                aliases.extend(["Kannada faculty room", "EEE 104 staff room"])

            search_blob = (
                f"room {rnum} {rnum_compact} {rd['room_name']} {rd['room_type'].replace('_', ' ')} "
                f"{_clean_text(rd.get('description'))} floor {_clean_text(rd.get('floor_name'))} "
                f"building {_clean_text(rd.get('building_name'))} {_clean_text(rd.get('building_code'))} "
                f"faculty seated occupants {occ_names} "
                f"{'wheelchair accessible step free elevator' if rd.get('is_accessible') else ''}"
            )
            docs.append(
                KnowledgeDoc(
                    doc_id=f"ROOM:{rid}",
                    entity_type="ROOM",
                    entity_id=rid,
                    title=f"{rnum} — {rd['room_name']}",
                    aliases=aliases,
                    search_text=search_blob,
                    metadata={**rd, "occupants": occs},
                )
            )

        # Build Semantic Documents for Buildings
        for bid, bd in self.buildings_by_id.items():
            aliases = [bd["building_name"], bd["building_code"], f"{bd['building_code']} block", f"{bd['building_code']} building"]
            search_blob = (
                f"building {bd['building_code']} {bd['building_name']} {bd['building_type'].replace('_', ' ')} "
                f"{_clean_text(bd.get('description'))} {bd['total_floors']} floors "
                f"{'wheelchair accessible ramp lift' if bd.get('is_accessible') else ''}"
            )
            docs.append(
                KnowledgeDoc(
                    doc_id=f"BUILDING:{bid}",
                    entity_type="BUILDING",
                    entity_id=bid,
                    title=bd["building_name"],
                    aliases=aliases,
                    search_text=search_blob,
                    metadata=bd,
                )
            )

        # Build Semantic Documents for Departments
        for dcode, dd in self.departments_by_code.items():
            aliases = [dd["dept_name"], dd["dept_code"], f"{dd['dept_code']} department"]
            search_blob = (
                f"department {dd['dept_code']} {dd['dept_name']} {_clean_text(dd.get('short_description'))} "
                f"building {_clean_text(dd.get('primary_building_name'))} email {_clean_text(dd.get('official_email'))} "
                f"{dd.get('faculty_count', 0)} faculty members"
            )
            docs.append(
                KnowledgeDoc(
                    doc_id=f"DEPARTMENT:{dd['dept_id']}",
                    entity_type="DEPARTMENT",
                    entity_id=dd["dept_id"],
                    title=dd["dept_name"],
                    aliases=aliases,
                    search_text=search_blob,
                    metadata=dd,
                )
            )

        # Build Semantic Documents for Facilities
        for fcid, fcd in self.facilities_by_id.items():
            cat_words = fcd["category"].replace("_", " ").lower()
            extra_synonyms = ""
            aliases = [fcd["facility_name"], cat_words]
            if "FOOD" in fcd["category"]:
                extra_synonyms = "canteen cafeteria food court lunch snacks coffee tea restaurant dining meals"
                aliases.extend(["canteen", "cafeteria", "food court", "eat lunch", "coffee snacks"])
            elif "BANK" in fcd["category"]:
                extra_synonyms = "atm bank cash withdrawal money kotak mahindra finance"
                aliases.extend(["campus atm", "bank atm", "cash withdrawal"])
            elif "MEDICAL" in fcd["category"]:
                extra_synonyms = "hospital clinic doctor ambulance first aid emergency health centre medical"
                aliases.extend(["medical clinic", "first aid", "emergency health centre", "campus doctor"])
            elif "TRANSPORT" in fcd["category"]:
                extra_synonyms = "metro station train bus gate entrance mysuru road public transport"
                aliases.extend(["metro station", "namma metro", "bus stop"])
            elif "PARKING" in fcd["category"]:
                extra_synonyms = "car bike two wheeler visitor parking lot vehicle"
                aliases.extend(["visitor parking", "car bike parking"])
            search_blob = (
                f"facility {fcd['facility_name']} {cat_words} {extra_synonyms} "
                f"{_clean_text(fcd.get('description'))} {_clean_text(fcd.get('building_name'))} "
                f"hours {_clean_text(fcd.get('opening_hours'))}"
            )
            docs.append(
                KnowledgeDoc(
                    doc_id=f"FACILITY:{fcid}",
                    entity_type="FACILITY",
                    entity_id=fcid,
                    title=fcd["facility_name"],
                    aliases=aliases,
                    search_text=search_blob,
                    metadata=fcd,
                )
            )

        self.docs = docs
        corpus_texts = [d.search_text for d in docs]
        tokenized_corpus = [_tokenize(t) for t in corpus_texts]
        self.bm25 = BM25Okapi(tokenized_corpus)

        self.word_vectorizer = TfidfVectorizer(ngram_range=(1, 2), stop_words="english", sublinear_tf=True)
        self.word_matrix = self.word_vectorizer.fit_transform(corpus_texts)

        self.char_vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
        self.char_matrix = self.char_vectorizer.fit_transform(corpus_texts)
        self.built_at = time.time()

    def hybrid_retrieve(
        self,
        query: str,
        top_k: int = 8,
        entity_filter: set[str] | None = None,
    ) -> list[tuple[KnowledgeDoc, float]]:
        if not self.docs:
            return []

        q_clean = query.strip()
        q_tokens = _tokenize(q_clean)

        # 1. BM25 scores
        bm25_scores = np.array(self.bm25.get_scores(q_tokens)) if self.bm25 else np.zeros(len(self.docs))

        # 2. TF-IDF Word Cosine scores
        if self.word_vectorizer is not None and self.word_matrix is not None:
            q_word_vec = self.word_vectorizer.transform([q_clean])
            word_scores = cosine_similarity(q_word_vec, self.word_matrix).flatten()
        else:
            word_scores = np.zeros(len(self.docs))

        # 3. TF-IDF Character N-Gram Cosine scores (handles typos & partial names)
        if self.char_vectorizer is not None and self.char_matrix is not None:
            q_char_vec = self.char_vectorizer.transform([q_clean])
            char_scores = cosine_similarity(q_char_vec, self.char_matrix).flatten()
        else:
            char_scores = np.zeros(len(self.docs))

        # 4. RapidFuzz Entity Title/Alias Similarity using focused entity query
        fuzzy_scores = np.zeros(len(self.docs))
        q_lower = q_clean.lower()
        q_focus = _extract_entity_focus(q_clean)
        for idx, doc in enumerate(self.docs):
            best_alias = 0.0
            for al in doc.aliases:
                if not al:
                    continue
                al_l = al.lower().strip()
                r_full = fuzz.ratio(q_focus, al_l)
                if len(al_l) <= 5:
                    # Short acronym/code: require exact token or high full-string ratio (prevent partial_ratio noise)
                    score = 100.0 if al_l in q_tokens else r_full * 0.75
                else:
                    r_w = fuzz.WRatio(q_focus, al_l)
                    r_tok = fuzz.token_set_ratio(q_focus, al_l) * 0.94
                    score = max(r_full, r_w, r_tok)
                    if r_full >= 78:
                        score += 22.0
                if score > best_alias:
                    best_alias = score
            fuzzy_scores[idx] = best_alias / 100.0

        # Reciprocal Rank Fusion (RRF) + Weighted Score Combination
        bm25_ranks = np.argsort(-bm25_scores)
        word_ranks = np.argsort(-word_scores)
        char_ranks = np.argsort(-char_scores)
        fuzzy_ranks = np.argsort(-fuzzy_scores)

        rrf_k = 20.0
        combined = (fuzzy_scores * 0.65) + (char_scores * 0.22) + (word_scores * 0.15)
        for rank, doc_idx in enumerate(bm25_ranks[:40]):
            if bm25_scores[doc_idx] > 0:
                combined[doc_idx] += 1.0 / (rrf_k + rank + 1)
        for rank, doc_idx in enumerate(word_ranks[:40]):
            if word_scores[doc_idx] > 0:
                combined[doc_idx] += 1.0 / (rrf_k + rank + 1)
        for rank, doc_idx in enumerate(char_ranks[:40]):
            if char_scores[doc_idx] > 0.08:
                combined[doc_idx] += 1.1 / (rrf_k + rank + 1)
        for rank, doc_idx in enumerate(fuzzy_ranks[:40]):
            if fuzzy_scores[doc_idx] > 0.55:
                combined[doc_idx] += 1.5 / (rrf_k + rank + 1)

        # Direct bonus for strong fuzzy match or exact substring match
        for idx, doc in enumerate(self.docs):
            if entity_filter and doc.entity_type not in entity_filter:
                combined[idx] = -1.0
                continue
            for al in doc.aliases:
                al_l = al.lower()
                if len(al_l) >= 3 and (al_l in q_lower or q_lower in al_l):
                    combined[idx] += 0.15
                    break

        top_indices = np.argsort(-combined)
        results: list[tuple[KnowledgeDoc, float]] = []
        for idx in top_indices:
            sc = float(combined[idx])
            if sc <= 0.01:
                break
            results.append((self.docs[int(idx)], sc))
            if len(results) >= top_k:
                break
        return results


_GLOBAL_RAG_INDEX = CampusRagIndex()


def get_or_build_rag_index(conn: Connection) -> CampusRagIndex:
    if not _GLOBAL_RAG_INDEX.is_fresh():
        _GLOBAL_RAG_INDEX.build_from_db(conn)
    return _GLOBAL_RAG_INDEX


def _resolve_place_coordinates(
    name_query: str,
    idx: CampusRagIndex,
) -> dict[str, Any] | None:
    """Finds the best matching building, room, or facility for turn-by-turn routing."""
    hits = idx.hybrid_retrieve(
        name_query,
        top_k=3,
        entity_filter={"BUILDING", "ROOM", "FACILITY", "FACULTY"},
    )
    if not hits:
        return None
    top_doc, _ = hits[0]
    md = top_doc.metadata
    if top_doc.entity_type == "BUILDING":
        return {
            "label": f"{md['building_name']} ({md['building_code']})",
            "lat": float(md["latitude"]),
            "lng": float(md["longitude"]),
            "building_id": md["building_id"],
            "floor_id": None,
            "room_id": None,
        }
    if top_doc.entity_type == "ROOM":
        b = idx.buildings_by_id.get(md.get("building_id") or 7)
        lat = float(md.get("building_latitude") or (b["latitude"] if b else 12.9241))
        lng = float(md.get("building_longitude") or (b["longitude"] if b else 77.499919))
        return {
            "label": f"{md['room_number']} — {md['room_name']}",
            "lat": lat,
            "lng": lng,
            "building_id": md.get("building_id"),
            "floor_id": md.get("floor_id"),
            "room_id": md["room_id"],
        }
    if top_doc.entity_type == "FACILITY":
        if md.get("latitude") and md.get("longitude"):
            return {
                "label": md["facility_name"],
                "lat": float(md["latitude"]),
                "lng": float(md["longitude"]),
                "building_id": md.get("building_id"),
                "floor_id": md.get("floor_id"),
                "room_id": md.get("room_id"),
            }
    if top_doc.entity_type == "FACULTY":
        if md.get("building_latitude") and md.get("building_longitude"):
            return {
                "label": f"{md['display_name']} ({md.get('office_room_number') or md.get('building_name')})",
                "lat": float(md["building_latitude"]),
                "lng": float(md["building_longitude"]),
                "building_id": md.get("building_id"),
                "floor_id": md.get("floor_id"),
                "room_id": md.get("office_room_id"),
            }
    return None


async def answer_campus_query(
    query: str,
    conn: Connection,
    history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    idx = get_or_build_rag_index(conn)
    q_raw = query.strip()
    q_lower = q_raw.lower()

    # 1. Context Resolution from Conversation History
    effective_query = q_raw
    if history:
        last_topics = [
            h.get("context_topic", "")
            for h in reversed(history)
            if h.get("context_topic")
        ]
        if last_topics and any(
            pron in f" {q_lower} "
            for pron in [" his ", " her ", " their ", " that room ", " that cabin ", " there ", " same room ", " who else "]
        ):
            effective_query = f"{q_raw} ({last_topics[0]})"

    cards: list[dict[str, Any]] = []
    suggestions: list[str] = []
    context_topic: str = ""

    # -------------------------------------------------------------------------
    # CASE A: Turn-by-Turn Route / Distance / Directions Question
    # e.g. "How do I walk from Main Gate to ABB Micro Grid Lab?" or "Directions to EEE-104"
    # -------------------------------------------------------------------------
    from_to_match = re.search(r"\bfrom\s+(.+?)\s+to\s+(.+)", effective_query, flags=re.I)
    single_dest_match = re.search(
        r"\b(?:route|directions?|walk|navigate|way|how\s+to\s+(?:go|reach|get))\s+(?:to\s+)?(.+)",
        effective_query,
        flags=re.I,
    )
    if (from_to_match or single_dest_match) and not any(w in q_lower for w in ["who sits", "who is in", "which faculty"]):
        if from_to_match:
            orig_name = from_to_match.group(1).strip(" ?.")
            dest_name = from_to_match.group(2).strip(" ?.")
        else:
            orig_name = "Main Mysuru Road Entrance Gate"
            dest_name = (single_dest_match.group(1) if single_dest_match else "").strip(" ?.")

        orig_place = _resolve_place_coordinates(orig_name, idx) or {
            "label": "Main Mysuru Road Entrance Gate",
            "lat": 12.924631,
            "lng": 77.49904,
            "building_id": 1,
            "floor_id": None,
            "room_id": None,
        }
        dest_place = _resolve_place_coordinates(dest_name, idx)

        if dest_place:
            route_data = await compute_campus_route(
                from_lat=orig_place["lat"],
                from_lng=orig_place["lng"],
                to_lat=dest_place["lat"],
                to_lng=dest_place["lng"],
                mode="WALKING",
                from_label=orig_place["label"],
                to_label=dest_place["label"],
            )
            dist_m = round(route_data["total_distance_m"])
            walk_min = max(1, round(route_data.get("total_duration_seconds", 180) / 60))
            context_topic = dest_place["label"]

            cards.append(
                {
                    "card_type": "ROUTE",
                    "title": f"{orig_place['label']} → {dest_place['label']}",
                    "subtitle": f"{dist_m} m • ~{walk_min} min walk • {len(route_data.get('steps', []))} steps",
                    "distance_m": dist_m,
                    "duration_min": walk_min,
                    "from_lat": orig_place["lat"],
                    "from_lng": orig_place["lng"],
                    "from_label": orig_place["label"],
                    "to_lat": dest_place["lat"],
                    "to_lng": dest_place["lng"],
                    "to_label": dest_place["label"],
                    "building_id": dest_place.get("building_id"),
                    "floor_id": dest_place.get("floor_id"),
                    "room_id": dest_place.get("room_id"),
                    "steps_preview": [s["instruction"] for s in route_data.get("steps", [])[:4]],
                }
            )

            answer = (
                f"To get from **{orig_place['label']}** to **{dest_place['label']}**, it is a "
                f"**{dist_m}-meter** walk (approximately **{walk_min} min** along campus pathways)."
            )
            if dest_place.get("room_id") and dest_place.get("floor_id"):
                rm = idx.rooms_by_id.get(int(dest_place["room_id"]))
                if rm:
                    answer += f" Once inside **{rm.get('building_name')}**, head to **{rm.get('floor_name')}** for **{rm['room_number']}**."
            suggestions = [
                f"Who sits in {dest_place['label'].split('—')[0].strip()}?",
                "Where is the nearest cafeteria?",
                "Show wheelchair accessible labs in EEE",
            ]
            return {
                "query": q_raw,
                "answer": answer,
                "cards": cards,
                "suggestions": suggestions,
                "context_topic": context_topic,
                "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
            }

    # -------------------------------------------------------------------------
    # CASE B: Specific Room / Cabin Code or Kannada / Counselling Cabin Query
    # -------------------------------------------------------------------------
    explicit_room_match = re.search(
        r"\b(eee[-\s]?(?:001|002|003|004|005|006|007|010|011a|011b|011|101|102|103|104|105|107|108|112|113|114|115|116|117|201|202a|202b|203|204|205|207|208|214|215|ech)|adm[-\s]?0[1-4]|cse[-\s]?off|ece[-\s]?off|aiml[-\s]?off)\b",
        effective_query,
        flags=re.I,
    )
    target_room_code: str | None = None
    if explicit_room_match:
        raw_code = re.sub(r"[\s\-]+", "-", explicit_room_match.group(1).upper())
        if not "-" in raw_code and raw_code.startswith("EEE"):
            raw_code = f"EEE-{raw_code[3:]}"
        target_room_code = raw_code
    elif "counselling" in q_lower:
        target_room_code = "EEE-101"
    elif "kannada" in q_lower:
        target_room_code = "EEE-104"

    if target_room_code and target_room_code in idx.rooms_by_code:
        rm = idx.rooms_by_code[target_room_code]
        occs = idx.occupants_by_room_id.get(rm["room_id"], [])
        if "kannada" in q_lower:
            kannada_occs = [o for o in occs if "kannada" in _clean_text(o.get("program_name")).lower() or o["staff_id"] in (222, 223, 224)]
        else:
            kannada_occs = []

        context_topic = rm["room_number"]
        cards.append(
            {
                "card_type": "ROOM",
                "room_id": rm["room_id"],
                "room_number": rm["room_number"],
                "title": f"{rm['room_number']} — {rm['room_name']}",
                "subtitle": f"{rm.get('building_name')} • {rm.get('floor_name')} • {rm['room_type'].replace('_', ' ')}",
                "description": rm.get("description"),
                "building_id": rm.get("building_id"),
                "floor_id": rm.get("floor_id"),
                "floor_name": rm.get("floor_name"),
                "is_accessible": bool(rm.get("is_accessible")),
                "capacity": rm.get("capacity"),
                "occupants_count": len(occs),
            }
        )
        for o in (kannada_occs if kannada_occs else occs):
            cards.append(
                {
                    "card_type": "FACULTY",
                    "staff_id": o["staff_id"],
                    "title": o["display_name"],
                    "subtitle": f"{o['designation']} • {o['dept_code']}",
                    "room_number": rm["room_number"],
                    "floor_name": rm.get("floor_name"),
                    "building_name": rm.get("building_name"),
                    "building_id": rm.get("building_id"),
                    "floor_id": rm.get("floor_id"),
                    "room_id": rm["room_id"],
                    "availability": o.get("effective_availability", "UNKNOWN"),
                }
            )

        if kannada_occs:
            names_str = ", ".join(f"**{o['display_name']}**" for o in kannada_occs)
            answer = (
                f"The Kannada faculty members ({names_str}) are seated in **{rm['room_number']} ({rm['room_name']})** "
                f"on the **{rm.get('floor_name')}** of the **{rm.get('building_name')}**, alongside {len(occs) - len(kannada_occs)} other EEE faculty members."
            )
        elif occs:
            names_str = ", ".join(f"**{o['display_name']}**" for o in occs)
            answer = (
                f"**{rm['room_number']} ({rm['room_name']})** is on the **{rm.get('floor_name')}** of the "
                f"**{rm.get('building_name')}**. There {'is 1 professor' if len(occs) == 1 else f'are {len(occs)} faculty members'} seated here: {names_str}."
            )
        else:
            answer = (
                f"**{rm['room_number']} ({rm['room_name']})** is located on the **{rm.get('floor_name')}** "
                f"of the **{rm.get('building_name')}** ({rm.get('description') or rm['room_type'].replace('_', ' ')})."
            )

        suggestions = [
            f"How do I walk from Main Gate to {rm['room_number']}?",
            "Show all rooms on First Floor of EEE",
            "Who sits in EEE-115?",
        ]
        return {
            "query": q_raw,
            "answer": answer,
            "cards": cards,
            "suggestions": suggestions,
            "context_topic": context_topic,
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
        }

    # -------------------------------------------------------------------------
    # CASE C: Wheelchair / Step-Free Accessibility or Floor Summary Query
    # -------------------------------------------------------------------------
    if any(w in q_lower for w in ["wheelchair", "step-free", "step free", "accessible lab", "elevator", "lift"]):
        eee_rooms = [
            r for r in idx.rooms_by_id.values()
            if r.get("building_id") == 7 and r.get("is_accessible") and r.get("room_type") == "LABORATORY"
        ]
        for rm in eee_rooms[:5]:
            cards.append(
                {
                    "card_type": "ROOM",
                    "room_id": rm["room_id"],
                    "room_number": rm["room_number"],
                    "title": f"{rm['room_number']} — {rm['room_name']}",
                    "subtitle": f"{rm.get('floor_name')} • Step-Free & Lift Accessible",
                    "description": rm.get("description"),
                    "building_id": rm.get("building_id"),
                    "floor_id": rm.get("floor_id"),
                    "floor_name": rm.get("floor_name"),
                    "is_accessible": True,
                    "capacity": rm.get("capacity"),
                    "occupants_count": len(idx.occupants_by_room_id.get(rm["room_id"], [])),
                }
            )
        answer = (
            f"The **Electrical & Instrumentation Block (EEE)** features step-free ramp access and elevator service across **Ground Floor, First Floor, and Second Floor**, including **{len(eee_rooms)} wheelchair-accessible laboratories** such as **{', '.join(r['room_number'] + ' (' + r['room_name'] + ')' for r in eee_rooms[:4])}**."
        )
        return {
            "query": q_raw,
            "answer": answer,
            "cards": cards,
            "suggestions": [
                "How do I walk from Main Gate to EEE Block?",
                "Where is the 24x7 Medical & First-Aid Clinic?",
                "Who sits in EEE-101 Counselling Room?",
            ],
            "context_topic": "EEE Block",
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
        }

    # -------------------------------------------------------------------------
    # CASE D: General Hybrid RAG Retrieval (Faculty, Facilities, Buildings, Depts)
    # -------------------------------------------------------------------------
    retrieved = idx.hybrid_retrieve(effective_query, top_k=6)
    if not retrieved:
        return {
            "query": q_raw,
            "answer": (
                "I couldn't find an exact match for that query. You can ask me about any **RVCE professor** (e.g., *Dr. Sushmita Sarkar*, *Dr. C. Suresha*, *Dr. P. Nagaraju*), **cabin or lab** (e.g., *EEE-104*, *EEE-201*, *ABB Micro Grid Lab*), **campus amenity** (*cafeteria, ATM, medical clinic*), or **walking directions** between any two places on campus."
            ),
            "cards": [],
            "suggestions": [
                "Who sits in EEE-104?",
                "Where is Dr. C. Suresha?",
                "How do I walk from Main Gate to EEE-201?",
            ],
            "context_topic": "",
            "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
        }

    top_doc, top_score = retrieved[0]
    md = top_doc.metadata

    if top_doc.entity_type == "FACULTY":
        # Collect top matching faculty members
        fac_docs = [d for d, sc in retrieved if d.entity_type == "FACULTY" and sc >= top_score * 0.72][:4]
        primary = fac_docs[0].metadata
        context_topic = primary.get("office_room_number") or primary["display_name"]

        for fd_doc in fac_docs:
            f = fd_doc.metadata
            cards.append(
                {
                    "card_type": "FACULTY",
                    "staff_id": f["staff_id"],
                    "title": f["display_name"],
                    "subtitle": f"{f['designation']} • {f['dept_code']}",
                    "room_number": f.get("office_room_number"),
                    "floor_name": f.get("floor_name"),
                    "building_name": f.get("building_name"),
                    "building_id": f.get("building_id"),
                    "floor_id": f.get("floor_id"),
                    "room_id": f.get("office_room_id"),
                    "availability": f.get("effective_availability", "UNKNOWN"),
                }
            )

        if primary.get("office_room_number"):
            co_occs = [
                o["display_name"]
                for o in idx.occupants_by_room_id.get(primary["office_room_id"], [])
                if o["staff_id"] != primary["staff_id"]
            ]
            co_text = (
                f" They share this cabin with {', '.join(co_occs[:4])}{' and others' if len(co_occs) > 4 else ''}."
                if co_occs
                else ""
            )
            answer = (
                f"**{primary['display_name']}** ({primary['designation']}, {primary['dept_name']}) sits in "
                f"Cabin **{primary['office_room_number']}** ({primary.get('office_room_name')}) on the "
                f"**{primary.get('floor_name')}** of the **{primary.get('building_name')}**.{co_text}"
            )
            suggestions = [
                f"Who else sits in {primary['office_room_number']}?",
                f"How do I walk from Main Gate to {primary['office_room_number']}?",
                f"Show {primary.get('floor_name')} layout of {primary.get('building_code')}",
            ]
        else:
            answer = (
                f"**{primary['display_name']}** is an **{primary['designation']}** in the **{primary['dept_name']}**, "
                f"located at the **{primary.get('building_name') or primary['dept_code'] + ' Block'}**."
            )
            suggestions = [
                f"How do I walk from Main Gate to {primary.get('building_name') or primary['dept_code']}?",
                f"Who is the HOD of {primary['dept_code']}?",
            ]

    elif top_doc.entity_type == "ROOM":
        rm = md
        occs = rm.get("occupants", [])
        context_topic = rm["room_number"]
        cards.append(
            {
                "card_type": "ROOM",
                "room_id": rm["room_id"],
                "room_number": rm["room_number"],
                "title": f"{rm['room_number']} — {rm['room_name']}",
                "subtitle": f"{rm.get('building_name')} • {rm.get('floor_name')}",
                "description": rm.get("description"),
                "building_id": rm.get("building_id"),
                "floor_id": rm.get("floor_id"),
                "floor_name": rm.get("floor_name"),
                "is_accessible": bool(rm.get("is_accessible")),
                "capacity": rm.get("capacity"),
                "occupants_count": len(occs),
            }
        )
        for o in occs[:6]:
            cards.append(
                {
                    "card_type": "FACULTY",
                    "staff_id": o["staff_id"],
                    "title": o["display_name"],
                    "subtitle": f"{o['designation']} • {o['dept_code']}",
                    "room_number": rm["room_number"],
                    "floor_name": rm.get("floor_name"),
                    "building_name": rm.get("building_name"),
                    "building_id": rm.get("building_id"),
                    "floor_id": rm.get("floor_id"),
                    "room_id": rm["room_id"],
                    "availability": o.get("effective_availability", "UNKNOWN"),
                }
            )
        occ_summary = (
            f" Seated faculty: {', '.join('**' + o['display_name'] + '**' for o in occs)}."
            if occs
            else ""
        )
        answer = (
            f"**{rm['room_number']} ({rm['room_name']})** is located on the **{rm.get('floor_name')}** "
            f"of the **{rm.get('building_name')}**. {rm.get('description') or ''}{occ_summary}"
        )
        suggestions = [
            f"How do I walk from Main Gate to {rm['room_number']}?",
            "Show all rooms in EEE Building",
        ]

    elif top_doc.entity_type == "FACILITY":
        fac_docs = [d for d, sc in retrieved if d.entity_type == "FACILITY" and sc >= top_score * 0.65][:3]
        for fd_doc in fac_docs:
            f = fd_doc.metadata
            cards.append(
                {
                    "card_type": "FACILITY",
                    "facility_id": f["facility_id"],
                    "title": f["facility_name"],
                    "subtitle": f"{f['category'].replace('_', ' ')} • {f.get('opening_hours') or 'Open'}",
                    "description": f.get("description"),
                    "building_id": f.get("building_id"),
                    "latitude": f.get("latitude"),
                    "longitude": f.get("longitude"),
                }
            )
        primary = fac_docs[0].metadata
        context_topic = primary["facility_name"]
        answer = (
            f"**{primary['facility_name']}** ({primary.get('description') or primary['category'].replace('_', ' ')}) "
            f"is open **{primary.get('opening_hours') or 'during campus hours'}**."
        )
        suggestions = [
            f"How do I walk from Main Gate to {primary['facility_name']}?",
            "Where is the nearest ATM?",
            "Where is the Medical & First-Aid Clinic?",
        ]

    elif top_doc.entity_type in ("BUILDING", "DEPARTMENT"):
        b_id = md.get("building_id") or md.get("primary_building_id") or 7
        b = idx.buildings_by_id.get(int(b_id)) or list(idx.buildings_by_id.values())[0]
        context_topic = b["building_name"]
        cards.append(
            {
                "card_type": "BUILDING",
                "building_id": b["building_id"],
                "building_code": b["building_code"],
                "title": b["building_name"],
                "subtitle": f"Code: {b['building_code']} • {b['total_floors']} Floors • {b.get('public_rooms_count', 0)} Mapped Spaces",
                "description": b.get("description"),
                "latitude": b["latitude"],
                "longitude": b["longitude"],
            }
        )
        answer = (
            f"**{b['building_name']} ({b['building_code']})** is a {b['total_floors']}-floor "
            f"{b['building_type'].replace('_', ' ').lower()} on campus. {b.get('description') or ''}"
        )
        suggestions = [
            f"How do I walk from Main Gate to {b['building_name']}?",
            f"Who is the HOD of {b['building_code']}?",
        ]

    return {
        "query": q_raw,
        "answer": answer,
        "cards": cards,
        "suggestions": suggestions,
        "context_topic": context_topic,
        "latency_ms": round((time.perf_counter() - t0) * 1000, 1),
    }
