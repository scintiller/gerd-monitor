import { useEffect, useState } from 'react';
import type { Overview, RefluxEvent, Summary, Zoom } from './types';

const BASE = `${import.meta.env.BASE_URL}data`;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export function useSummary() {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => { fetchJson<Summary>(`${BASE}/summary.json`).then(setData); }, []);
  return data;
}

export function useEvents() {
  const [data, setData] = useState<RefluxEvent[] | null>(null);
  useEffect(() => { fetchJson<RefluxEvent[]>(`${BASE}/events.json`).then(setData); }, []);
  return data;
}

export function useOverview() {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => { fetchJson<Overview>(`${BASE}/overview.json`).then(setData); }, []);
  return data;
}

export function useZoom(eventId: number | null) {
  const [data, setData] = useState<Zoom | null>(null);
  useEffect(() => {
    if (eventId == null) { setData(null); return; }
    const id = String(eventId).padStart(4, '0');
    fetchJson<Zoom>(`${BASE}/zoom/event_${id}.json`).then(setData);
  }, [eventId]);
  return data;
}
