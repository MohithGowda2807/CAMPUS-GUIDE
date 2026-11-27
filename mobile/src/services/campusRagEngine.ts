import {
  FALLBACK_BUILDINGS,
  FALLBACK_DEPARTMENTS,
  FALLBACK_FACILITIES,
  FALLBACK_FACULTY,
  FALLBACK_ROOMS_BY_ID,
} from '../data/fallbackData';
import { computeCampusRouteOffline } from './campusRouter';

export interface AssistantCard {
  card_type: 'FACULTY' | 'ROOM' | 'BUILDING' | 'FACILITY' | 'ROUTE';
  title: string;
  subtitle: string;
  description?: string | null;
  staff_id?: number;
  room_id?: number | null;
  room_number?: string | null;
  floor_id?: number | null;
  floor_name?: string | null;
  building_id?: number | null;
  building_code?: string | null;
  building_name?: string | null;
  facility_id?: number;
  latitude?: number | null;
  longitude?: number | null;
  availability?: string;
  is_accessible?: boolean;
  capacity?: number | null;
  occupants_count?: number;
  distance_m?: number;
  duration_min?: number;
  from_lat?: number;
  from_lng?: number;
  from_label?: string;
  to_lat?: number;
  to_lng?: number;
  to_label?: string;
  steps_preview?: string[];
}

export interface AssistantResponse {
  query: string;
  answer: string;
  cards: AssistantCard[];
  suggestions: string[];
  context_topic: string;
  latency_ms: number;
}

const STOP_WORDS = new Set([
  'where', 'who', 'what', 'which', 'when', 'how', 'is', 'are', 'was', 'were',
  'does', 'do', 'can', 'could', 'would', 'should', 'sit', 'sits', 'sitting',
  'seated', 'cabin', 'office', 'location', 'locate', 'find', 'show', 'tell',
  'me', 'about', 'the', 'a', 'an', 'in', 'at', 'on', 'of', 'for', 'to', 'from',
  'with', 'professor', 'prof', 'faculty', 'teacher', 'maam', 'mam', 'sir',
  'dr', 'mr', 'ms', 'mrs', 'please', 'pls', 'rvce',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/[\s\-]+/)
    .filter((w) => w.length > 1);
}

function extractEntityFocus(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return words.join(' ').trim() || text.toLowerCase().trim();
}

/**
 * Character trigrams Sorensen-Dice / Cosine similarity for typo-tolerant matching
 */
function charTrigramSimilarity(a: string, b: string): number {
  const s1 = `  ${a.toLowerCase().trim()}  `;
  const s2 = `  ${b.toLowerCase().trim()}  `;
  if (s1 === s2) return 1.0;
  if (s1.length < 3 || s2.length < 3) return 0.0;

  const grams1 = new Map<string, number>();
  for (let i = 0; i <= s1.length - 3; i++) {
    const g = s1.slice(i, i + 3);
    grams1.set(g, (grams1.get(g) || 0) + 1);
  }
  let intersection = 0;
  let total2 = 0;
  for (let i = 0; i <= s2.length - 3; i++) {
    const g = s2.slice(i, i + 3);
    total2++;
    const count = grams1.get(g) || 0;
    if (count > 0) {
      intersection++;
      grams1.set(g, count - 1);
    }
  }
  const total1 = s1.length - 2;
  return (2.0 * intersection) / (total1 + total2);
}

interface LocalRagDoc {
  id: string;
  entity_type: 'FACULTY' | 'ROOM' | 'BUILDING' | 'DEPARTMENT' | 'FACILITY';
  entity_id: number;
  title: string;
  aliases: string[];
  tokens: string[];
  search_blob: string;
  metadata: any;
}

let cachedDocs: LocalRagDoc[] | null = null;
let cachedIdf: Map<string, number> | null = null;
let avgDocLen = 20;

function ensureLocalRagIndex(): {
  docs: LocalRagDoc[];
  idf: Map<string, number>;
  avgLen: number;
} {
  if (cachedDocs && cachedIdf) {
    return { docs: cachedDocs, idf: cachedIdf, avgLen: avgDocLen };
  }

  const docs: LocalRagDoc[] = [];
  const roomsList = Object.values(FALLBACK_ROOMS_BY_ID);
  const occupantsByRoom = new Map<number, typeof FALLBACK_FACULTY>();

  for (const f of FALLBACK_FACULTY) {
    if (f.office_room_id) {
      const arr = occupantsByRoom.get(f.office_room_id) || [];
      arr.push(f);
      occupantsByRoom.set(f.office_room_id, arr);
    }
  }

  // 1. Faculty Docs
  for (const f of FALLBACK_FACULTY) {
    const cleanName = f.display_name.replace(/^(Dr\.?|Mr\.?|Ms\.?|Prof\.?)\s+/i, '').trim();
    const aliases = [f.display_name, cleanName, f.employee_code];
    if (f.office_room_number) aliases.push(f.office_room_number);
    if (f.program_name && f.program_name.toLowerCase().includes('kannada')) {
      aliases.push('Kannada faculty', 'Kannada teacher');
    }
    if (f.leadership_role) {
      aliases.push(f.leadership_role, `${f.leadership_role} ${f.dept_code}`);
    }
    const blob = `${f.display_name} ${cleanName} ${f.designation} ${f.leadership_role || ''} ${f.dept_code} ${f.dept_name} ${f.program_name || ''} ${f.office_room_number || ''} ${f.office_room_name || ''} ${f.floor_name || ''} ${f.building_name || ''}`;
    docs.push({
      id: `FACULTY:${f.staff_id}`,
      entity_type: 'FACULTY',
      entity_id: f.staff_id,
      title: f.display_name,
      aliases,
      tokens: tokenize(blob),
      search_blob: blob.toLowerCase(),
      metadata: f,
    });
  }

  // 2. Room Docs
  for (const r of roomsList) {
    const occs = occupantsByRoom.get(r.room_id) || [];
    const occNames = occs.map((o) => o.display_name).join(' ');
    const aliases = [r.room_number, r.room_number.replace('-', ' '), r.room_name];
    if (r.room_number.includes('101')) aliases.push('Counselling Room', 'EEE counselling cabin');
    if (r.room_number.includes('104')) aliases.push('Kannada faculty cabin', 'EEE 104 staff room');
    const blob = `room ${r.room_number} ${r.room_name} ${r.room_type} ${r.description || ''} ${r.floor_name || ''} ${r.building_name || ''} ${occNames} ${r.is_accessible ? 'wheelchair accessible lift step free' : ''}`;
    docs.push({
      id: `ROOM:${r.room_id}`,
      entity_type: 'ROOM',
      entity_id: r.room_id,
      title: `${r.room_number} — ${r.room_name}`,
      aliases,
      tokens: tokenize(blob),
      search_blob: blob.toLowerCase(),
      metadata: { ...r, occupants: occs },
    });
  }

  // 3. Building Docs
  for (const b of FALLBACK_BUILDINGS) {
    const aliases = [b.building_name, b.building_code, `${b.building_code} block`];
    const blob = `building ${b.building_code} ${b.building_name} ${b.building_type} ${b.description || ''}`;
    docs.push({
      id: `BUILDING:${b.building_id}`,
      entity_type: 'BUILDING',
      entity_id: b.building_id,
      title: b.building_name,
      aliases,
      tokens: tokenize(blob),
      search_blob: blob.toLowerCase(),
      metadata: b,
    });
  }

  // 4. Facility Docs
  for (const fc of FALLBACK_FACILITIES) {
    const aliases = [fc.facility_name, fc.category.replace(/_/g, ' ').toLowerCase()];
    let extra = '';
    if (fc.category.includes('FOOD')) {
      extra = 'canteen cafeteria food court lunch snacks coffee tea restaurant meals';
      aliases.push('canteen', 'cafeteria', 'food court', 'eat lunch', 'coffee snacks');
    } else if (fc.category.includes('BANK')) {
      extra = 'atm bank cash money kotak mahindra';
      aliases.push('campus atm', 'bank atm');
    } else if (fc.category.includes('MEDICAL')) {
      extra = 'hospital clinic doctor ambulance first aid emergency health centre';
      aliases.push('medical clinic', 'first aid', 'emergency health centre');
    } else if (fc.category.includes('TRANSPORT')) {
      extra = 'metro station train bus gate entrance';
      aliases.push('metro station', 'namma metro');
    } else if (fc.category.includes('PARKING')) {
      extra = 'car bike visitor parking lot';
      aliases.push('visitor parking');
    }
    const blob = `facility ${fc.facility_name} ${fc.category} ${extra} ${fc.description || ''} ${fc.opening_hours || ''}`;
    docs.push({
      id: `FACILITY:${fc.facility_id}`,
      entity_type: 'FACILITY',
      entity_id: fc.facility_id,
      title: fc.facility_name,
      aliases,
      tokens: tokenize(blob),
      search_blob: blob.toLowerCase(),
      metadata: fc,
    });
  }

  // Compute BM25 IDF weights
  const df = new Map<string, number>();
  let totalTokens = 0;
  for (const d of docs) {
    totalTokens += d.tokens.length;
    const seen = new Set(d.tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }
  avgDocLen = Math.max(1, totalTokens / docs.length);
  const N = docs.length;
  const idf = new Map<string, number>();
  for (const [term, freq] of df.entries()) {
    idf.set(term, Math.log(1 + (N - freq + 0.5) / (freq + 0.5)));
  }

  cachedDocs = docs;
  cachedIdf = idf;
  return { docs, idf, avgLen: avgDocLen };
}

function hybridSearchLocal(
  query: string,
  topK = 6,
  filterTypes?: Set<string>
): Array<{ doc: LocalRagDoc; score: number }> {
  const { docs, idf, avgLen } = ensureLocalRagIndex();
  const qTokens = tokenize(query);
  const qFocus = extractEntityFocus(query);
  const k1 = 1.5;
  const b = 0.75;

  const scored: Array<{ doc: LocalRagDoc; score: number }> = [];

  for (const doc of docs) {
    if (filterTypes && !filterTypes.has(doc.entity_type)) continue;

    // 1. Okapi BM25 lexical score
    let bm25 = 0;
    const tfMap = new Map<string, number>();
    for (const t of doc.tokens) tfMap.set(t, (tfMap.get(t) || 0) + 1);
    for (const qt of qTokens) {
      const tf = tfMap.get(qt) || 0;
      if (tf > 0) {
        const termIdf = idf.get(qt) || 1.0;
        bm25 +=
          termIdf *
          ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.tokens.length / avgLen))));
      }
    }

    // 2. Character Trigram Fuzzy Similarity over entity aliases
    let bestFuzzy = 0;
    for (const al of doc.aliases) {
      if (!al) continue;
      const alLower = al.toLowerCase().trim();
      if (alLower.length <= 5) {
        const exactTok = qTokens.includes(alLower) ? 1.0 : charTrigramSimilarity(qFocus, alLower) * 0.65;
        if (exactTok > bestFuzzy) bestFuzzy = exactTok;
      } else {
        const sim = charTrigramSimilarity(qFocus, alLower);
        const subBonus =
          alLower.includes(qFocus) || (qFocus.length >= 4 && qFocus.includes(alLower))
            ? 0.22
            : 0;
        const totalSim = sim + subBonus;
        if (totalSim > bestFuzzy) bestFuzzy = totalSim;
      }
    }

    const combined = bm25 * 0.14 + bestFuzzy * 0.85;
    if (combined > 0.16) {
      scored.push({ doc, score: combined });
    }
  }

  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, topK);
}

function resolvePlaceLocal(nameQuery: string) {
  const hits = hybridSearchLocal(
    nameQuery,
    3,
    new Set(['BUILDING', 'ROOM', 'FACILITY', 'FACULTY'])
  );
  if (hits.length === 0) return null;
  const top = hits[0].doc;
  const md = top.metadata;
  if (top.entity_type === 'BUILDING') {
    return {
      label: `${md.building_name} (${md.building_code})`,
      lat: Number(md.latitude),
      lng: Number(md.longitude),
      building_id: md.building_id,
      floor_id: null,
      room_id: null,
    };
  }
  if (top.entity_type === 'ROOM') {
    const b = FALLBACK_BUILDINGS.find((x) => x.building_id === (md.building_id || 7));
    return {
      label: `${md.room_number} — ${md.room_name}`,
      lat: b ? b.latitude : 12.9241,
      lng: b ? b.longitude : 77.499919,
      building_id: md.building_id || 7,
      floor_id: md.floor_id || null,
      room_id: md.room_id,
    };
  }
  if (top.entity_type === 'FACILITY' && md.latitude && md.longitude) {
    return {
      label: md.facility_name,
      lat: Number(md.latitude),
      lng: Number(md.longitude),
      building_id: md.building_id || null,
      floor_id: md.floor_id || null,
      room_id: md.room_id || null,
    };
  }
  if (top.entity_type === 'FACULTY' && md.building_latitude && md.building_longitude) {
    return {
      label: `${md.display_name} (${md.office_room_number || md.building_name})`,
      lat: Number(md.building_latitude),
      lng: Number(md.building_longitude),
      building_id: md.building_id || null,
      floor_id: md.floor_id || null,
      room_id: md.office_room_id || null,
    };
  }
  return null;
}

export function answerCampusQueryOffline(
  query: string,
  history?: Array<{ context_topic?: string }>
): AssistantResponse {
  const t0 = Date.now();
  const qRaw = query.trim();
  const qLower = qRaw.toLowerCase();

  let effectiveQuery = qRaw;
  if (history && history.length > 0) {
    const lastTopic = [...history].reverse().find((h) => h.context_topic)?.context_topic;
    if (
      lastTopic &&
      /\b(his|her|their|that room|that cabin|there|same room|who else)\b/i.test(qLower)
    ) {
      effectiveQuery = `${qRaw} (${lastTopic})`;
    }
  }

  const cards: AssistantCard[] = [];
  const allRooms = Object.values(FALLBACK_ROOMS_BY_ID);

  // 1. Directions / Route Intent
  const fromToMatch = effectiveQuery.match(/\bfrom\s+(.+?)\s+to\s+(.+)/i);
  const singleDestMatch = effectiveQuery.match(
    /\b(?:route|directions?|walk|navigate|way|how\s+to\s+(?:go|reach|get))\s+(?:to\s+)?(.+)/i
  );

  if (
    (fromToMatch || singleDestMatch) &&
    !/\b(who sits|who is in|which faculty)\b/i.test(qLower)
  ) {
    const origName = fromToMatch ? fromToMatch[1].replace(/[?.!]+$/, '').trim() : 'Main Gate';
    const destName = (fromToMatch ? fromToMatch[2] : singleDestMatch?.[1] || '')
      .replace(/[?.!]+$/, '')
      .trim();

    const origPlace = resolvePlaceLocal(origName) || {
      label: 'Main Mysuru Road Entrance Gate',
      lat: 12.924631,
      lng: 77.49904,
      building_id: 1,
      floor_id: null,
      room_id: null,
    };
    const destPlace = resolvePlaceLocal(destName);

    if (destPlace) {
      const routeData = computeCampusRouteOffline({
        fromLat: origPlace.lat,
        fromLng: origPlace.lng,
        toLat: destPlace.lat,
        toLng: destPlace.lng,
        mode: 'WALKING',
        fromLabel: origPlace.label,
        toLabel: destPlace.label,
      });
      const distM = Math.round(routeData.total_distance_m);
      const walkMin = Math.max(1, Math.round(routeData.total_duration_seconds / 60));

      cards.push({
        card_type: 'ROUTE',
        title: `${origPlace.label} → ${destPlace.label}`,
        subtitle: `${distM} m • ~${walkMin} min walk • ${routeData.steps.length} steps`,
        distance_m: distM,
        duration_min: walkMin,
        from_lat: origPlace.lat,
        from_lng: origPlace.lng,
        from_label: origPlace.label,
        to_lat: destPlace.lat,
        to_lng: destPlace.lng,
        to_label: destPlace.label,
        building_id: destPlace.building_id,
        floor_id: destPlace.floor_id,
        room_id: destPlace.room_id,
        steps_preview: routeData.steps.slice(0, 4).map((s) => s.instruction),
      });

      let answer = `To walk from **${origPlace.label}** to **${destPlace.label}**, follow the campus pathways for **${distM} meters** (around **${walkMin} min**).`;
      if (destPlace.room_id) {
        const rm = FALLBACK_ROOMS_BY_ID[destPlace.room_id];
        if (rm) {
          answer += ` Once inside **${rm.building_name}**, head to **${rm.floor_name}** for **${rm.room_number}**.`;
        }
      }
      return {
        query: qRaw,
        answer,
        cards,
        suggestions: [
          `Who sits in ${destPlace.label.split('—')[0].trim()}?`,
          'Where is the nearest cafeteria?',
          'Show wheelchair accessible labs in EEE',
        ],
        context_topic: destPlace.label,
        latency_ms: Date.now() - t0,
      };
    }
  }

  // 2. Explicit Room / Cabin / Kannada / Counselling Query
  const roomMatch = effectiveQuery.match(
    /\b(eee[-\s]?(?:001|002|003|004|005|006|007|010|011a|011b|011|101|102|103|104|105|107|108|112|113|114|115|116|117|201|202a|202b|203|204|205|207|208|214|215|ech)|adm[-\s]?0[1-4]|cse[-\s]?off|ece[-\s]?off|aiml[-\s]?off)\b/i
  );
  let targetCode: string | null = null;
  if (roomMatch) {
    let raw = roomMatch[1].toUpperCase().replace(/[\s\-]+/g, '-');
    if (!raw.includes('-') && raw.startsWith('EEE')) raw = `EEE-${raw.slice(3)}`;
    targetCode = raw;
  } else if (qLower.includes('counselling')) {
    targetCode = 'EEE-101';
  } else if (qLower.includes('kannada')) {
    targetCode = 'EEE-104';
  }

  if (targetCode) {
    const rm = allRooms.find((r) => r.room_number.toUpperCase() === targetCode);
    if (rm) {
      const occs = FALLBACK_FACULTY.filter((f) => f.office_room_id === rm.room_id);
      const kannadaOccs = qLower.includes('kannada')
        ? occs.filter(
            (o) =>
              (o.program_name && o.program_name.toLowerCase().includes('kannada')) ||
              [222, 223, 224].includes(o.staff_id)
          )
        : [];

      cards.push({
        card_type: 'ROOM',
        room_id: rm.room_id,
        room_number: rm.room_number,
        title: `${rm.room_number} — ${rm.room_name}`,
        subtitle: `${rm.building_name} • ${rm.floor_name} • ${rm.room_type.replace(/_/g, ' ')}`,
        description: rm.description,
        building_id: rm.building_id,
        floor_id: rm.floor_id,
        floor_name: rm.floor_name,
        is_accessible: rm.is_accessible,
        capacity: rm.capacity,
        occupants_count: occs.length,
      });

      const displayOccs = kannadaOccs.length > 0 ? kannadaOccs : occs;
      for (const o of displayOccs) {
        cards.push({
          card_type: 'FACULTY',
          staff_id: o.staff_id,
          title: o.display_name,
          subtitle: `${o.designation} • ${o.dept_code}`,
          room_number: rm.room_number,
          floor_name: rm.floor_name,
          building_name: rm.building_name,
          building_id: rm.building_id,
          floor_id: rm.floor_id,
          room_id: rm.room_id,
          availability: o.effective_availability,
        });
      }

      const answer =
        kannadaOccs.length > 0
          ? `The Kannada faculty members (${kannadaOccs.map((o) => `**${o.display_name}**`).join(', ')}) are seated in **${rm.room_number} (${rm.room_name})** on the **${rm.floor_name}** of the **${rm.building_name}**, alongside ${occs.length - kannadaOccs.length} other EEE faculty members.`
          : occs.length > 0
          ? `**${rm.room_number} (${rm.room_name})** is on the **${rm.floor_name}** of the **${rm.building_name}**. Seated faculty (${occs.length}): ${occs.map((o) => `**${o.display_name}**`).join(', ')}.`
          : `**${rm.room_number} (${rm.room_name})** is located on the **${rm.floor_name}** of the **${rm.building_name}** (${rm.description || rm.room_type.replace(/_/g, ' ')}).`;

      return {
        query: qRaw,
        answer,
        cards,
        suggestions: [
          `How do I walk from Main Gate to ${rm.room_number}?`,
          'Who sits in EEE-115?',
          'Who sits in EEE-201?',
        ],
        context_topic: rm.room_number,
        latency_ms: Date.now() - t0,
      };
    }
  }

  // 3. Wheelchair / Step-Free Accessibility Query
  if (/\b(wheelchair|step-free|step free|accessible lab|elevator|lift)\b/i.test(qLower)) {
    const eeeLabs = allRooms.filter(
      (r) => r.building_id === 7 && r.is_accessible && r.room_type === 'LABORATORY'
    );
    for (const rm of eeeLabs.slice(0, 5)) {
      cards.push({
        card_type: 'ROOM',
        room_id: rm.room_id,
        room_number: rm.room_number,
        title: `${rm.room_number} — ${rm.room_name}`,
        subtitle: `${rm.floor_name} • Step-Free & Lift Accessible`,
        description: rm.description,
        building_id: rm.building_id,
        floor_id: rm.floor_id,
        floor_name: rm.floor_name,
        is_accessible: true,
        capacity: rm.capacity,
      });
    }
    return {
      query: qRaw,
      answer: `The **Electrical & Instrumentation Block (EEE)** provides step-free ramp entry and elevator access across **Ground Floor, First Floor, and Second Floor**, including **${eeeLabs.length} wheelchair-accessible laboratories** (${eeeLabs.slice(0, 4).map((r) => `**${r.room_number}**`).join(', ')}).`,
      cards,
      suggestions: [
        'How do I walk from Main Gate to EEE Block?',
        'Where is the 24x7 Medical & First-Aid Clinic?',
        'Who sits in EEE-101 Counselling Room?',
      ],
      context_topic: 'EEE Block',
      latency_ms: Date.now() - t0,
    };
  }

  // 4. General Hybrid BM25 + Trigram Fuzzy Retrieval
  const retrieved = hybridSearchLocal(effectiveQuery, 5);
  if (retrieved.length === 0) {
    return {
      query: qRaw,
      answer:
        "I couldn't find an exact match for that. Try asking about any **professor** (e.g., *Dr. Sushmita Sarkar*, *Dr. C. Suresha*, *Dr. P. Nagaraju*), **cabin or lab** (*EEE-104*, *EEE-201*, *ABB Micro Grid Lab*), **campus amenity** (*canteen, ATM, medical clinic*), or **walking directions**.",
      cards: [],
      suggestions: [
        'Who sits in EEE-104?',
        'Where is Dr. C. Suresha?',
        'How do I walk from Main Gate to ABB Micro Grid Lab?',
      ],
      context_topic: '',
      latency_ms: Date.now() - t0,
    };
  }

  const top = retrieved[0].doc;
  const topScore = retrieved[0].score;
  const md = top.metadata;

  if (top.entity_type === 'FACULTY') {
    const facHits = retrieved
      .filter((r) => r.doc.entity_type === 'FACULTY' && r.score >= topScore * 0.72)
      .slice(0, 4);
    for (const h of facHits) {
      const f = h.doc.metadata;
      cards.push({
        card_type: 'FACULTY',
        staff_id: f.staff_id,
        title: f.display_name,
        subtitle: `${f.designation} • ${f.dept_code}`,
        room_number: f.office_room_number,
        floor_name: f.floor_name,
        building_name: f.building_name,
        building_id: f.building_id,
        floor_id: f.floor_id,
        room_id: f.office_room_id,
        availability: f.effective_availability,
      });
    }
    const coOccs = md.office_room_id
      ? FALLBACK_FACULTY.filter(
          (f) => f.office_room_id === md.office_room_id && f.staff_id !== md.staff_id
        )
      : [];
    const coText =
      coOccs.length > 0
        ? ` They share this cabin with ${coOccs.slice(0, 4).map((o) => o.display_name).join(', ')}${coOccs.length > 4 ? ' and others' : ''}.`
        : '';

    const answer = md.office_room_number
      ? `**${md.display_name}** (${md.designation}, ${md.dept_name}) sits in Cabin **${md.office_room_number}** (${md.office_room_name}) on the **${md.floor_name}** of the **${md.building_name}**.${coText}`
      : `**${md.display_name}** is an **${md.designation}** in the **${md.dept_name}**, located at the **${md.building_name || md.dept_code + ' Block'}**.`;

    return {
      query: qRaw,
      answer,
      cards,
      suggestions: md.office_room_number
        ? [
            `Who else sits in ${md.office_room_number}?`,
            `How do I walk from Main Gate to ${md.office_room_number}?`,
          ]
        : [`How do I walk from Main Gate to ${md.building_name}?`],
      context_topic: md.office_room_number || md.display_name,
      latency_ms: Date.now() - t0,
    };
  }

  if (top.entity_type === 'ROOM') {
    const occs = md.occupants || [];
    cards.push({
      card_type: 'ROOM',
      room_id: md.room_id,
      room_number: md.room_number,
      title: `${md.room_number} — ${md.room_name}`,
      subtitle: `${md.building_name} • ${md.floor_name}`,
      description: md.description,
      building_id: md.building_id,
      floor_id: md.floor_id,
      floor_name: md.floor_name,
      is_accessible: md.is_accessible,
      capacity: md.capacity,
      occupants_count: occs.length,
    });
    for (const o of occs.slice(0, 6)) {
      cards.push({
        card_type: 'FACULTY',
        staff_id: o.staff_id,
        title: o.display_name,
        subtitle: `${o.designation} • ${o.dept_code}`,
        room_number: md.room_number,
        floor_name: md.floor_name,
        building_name: md.building_name,
        building_id: md.building_id,
        floor_id: md.floor_id,
        room_id: md.room_id,
        availability: o.effective_availability,
      });
    }
    return {
      query: qRaw,
      answer: `**${md.room_number} (${md.room_name})** is on the **${md.floor_name}** of the **${md.building_name}**. ${md.description || ''}`,
      cards,
      suggestions: [`How do I walk from Main Gate to ${md.room_number}?`],
      context_topic: md.room_number,
      latency_ms: Date.now() - t0,
    };
  }

  if (top.entity_type === 'FACILITY') {
    const facHits = retrieved
      .filter((r) => r.doc.entity_type === 'FACILITY' && r.score >= topScore * 0.65)
      .slice(0, 3);
    for (const h of facHits) {
      const f = h.doc.metadata;
      cards.push({
        card_type: 'FACILITY',
        facility_id: f.facility_id,
        title: f.facility_name,
        subtitle: `${f.category.replace(/_/g, ' ')} • ${f.opening_hours || 'Open'}`,
        description: f.description,
        building_id: f.building_id,
        latitude: f.latitude,
        longitude: f.longitude,
      });
    }
    return {
      query: qRaw,
      answer: `**${md.facility_name}** (${md.description || md.category.replace(/_/g, ' ')}) is open **${md.opening_hours || 'during campus hours'}**.`,
      cards,
      suggestions: [
        `How do I walk from Main Gate to ${md.facility_name}?`,
        'Where is the nearest ATM?',
      ],
      context_topic: md.facility_name,
      latency_ms: Date.now() - t0,
    };
  }

  // BUILDING / DEPARTMENT
  const bId = md.building_id || md.primary_building_id || 7;
  const b = FALLBACK_BUILDINGS.find((x) => x.building_id === bId) || FALLBACK_BUILDINGS[0];
  cards.push({
    card_type: 'BUILDING',
    building_id: b.building_id,
    building_code: b.building_code,
    title: b.building_name,
    subtitle: `${b.building_code} • ${b.total_floors} Floors • ${b.public_rooms_count} Spaces`,
    description: b.description,
    latitude: b.latitude,
    longitude: b.longitude,
  });
  return {
    query: qRaw,
    answer: `**${b.building_name} (${b.building_code})** is a ${b.total_floors}-floor campus block. ${b.description || ''}`,
    cards,
    suggestions: [`How do I walk from Main Gate to ${b.building_name}?`],
    context_topic: b.building_name,
    latency_ms: Date.now() - t0,
  };
}
