import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcryptjs';

const secret = () => process.env.JWT_SECRET || 'propia-local-dev-secret-change-me';

export function signSession(sub: string) {
  const body = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readSession(token?: string): string | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload?.sub || payload.exp < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);

export function strongPassword(p: string) {
  return typeof p === 'string' && p.length >= 12 && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
}

export function code6() {
  return String(randomInt(0, 1000000)).padStart(6, '0');
}

export function money(n: number, currency = 'USD', cents = false) {
  const cur = currency === 'PEN' ? 'S/' : 'US$';
  const neg = n < 0;
  const abs = Math.abs(Number(n) || 0);
  const s = (cents ? abs.toFixed(2) : String(Math.round(abs))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '−' : ''}${cur} ${s}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function limaParts(d: Date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) map[p.type] = p.value;
  return map;
}

export function fmtDate(d: Date | string) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) && d.length <= 10) {
    const [y, m, day] = d.slice(0, 10).split('-').map(Number);
    return `${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
  }
  const date = new Date(d);
  const p = limaParts(date);
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
}

export function fmtWhen(d: Date | string) {
  const date = new Date(d);
  const p = limaParts(date);
  const now = limaParts(new Date());
  const hm = `${p.hour}:${p.minute}`;
  if (p.year === now.year && p.month === now.month && p.day === now.day) return `Hoy ${hm}`;
  const y = new Date();
  y.setDate(y.getDate() - 1);
  const yp = limaParts(y);
  if (p.year === yp.year && p.month === yp.month && p.day === yp.day) return `Ayer ${hm}`;
  return `${fmtDate(date)} ${hm}`;
}

export function ageLabel(d: Date | string) {
  const ms = Date.now() - new Date(d).getTime();
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  const days = Math.round(h / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

export const STATUS: Record<string, [string, string]> = {
  draft: ['Borrador', 'b-gray'],
  funding: ['En fondeo', 'b-blue'],
  funded: ['Fondeada', 'b-teal'],
  notary: ['En notaría', 'b-amber'],
  registered: ['Inscrita', 'b-teal'],
  operating: ['En operación', 'b-teal'],
  sale_vote: ['En votación', 'b-amber'],
  selling: ['En venta', 'b-blue'],
  sold: ['Vendida', 'b-teal'],
  cancelled: ['Cancelada', 'b-red'],
};

export const COMMIT: Record<string, [string, string]> = {
  pending_approval: ['Solicitud pendiente', 'b-amber'],
  active: ['En fondeo', 'b-blue'],
  owned: ['En operación', 'b-teal'],
  rejected: ['Solicitud rechazada', 'b-red'],
  cancelled: ['Cancelada', 'b-gray'],
};

export const OFFER: Record<string, [string, string]> = {
  internal_window: ['Ventana interna', 'b-amber'],
  open: ['Abierta', 'b-teal'],
  buyer_found: ['Comprador encontrado', 'b-blue'],
  retracto: ['En retracto', 'b-blue'],
  notary: ['En notaría', 'b-amber'],
  completed: ['Vendida', 'b-teal'],
  cancelled: ['Cancelada', 'b-gray'],
  expired: ['Vencida', 'b-red'],
};

export const INVESTOR: Record<string, [string, string]> = {
  onboarding: ['En habilitación', 'b-amber'],
  signing: ['Por firmar', 'b-blue'],
  review: ['En evaluación', 'b-amber'],
  observed: ['Observada', 'b-amber'],
  rejected: ['Rechazada', 'b-red'],
  enabled: ['Habilitado', 'b-teal'],
};

export function mask(num: string) {
  const digits = (num || '').replace(/\D/g, '');
  return `****${digits.slice(-4)}`;
}

export function daysLeft(date?: string | Date) {
  if (!date) return '—';
  const end = new Date(date).getTime();
  const days = Math.ceil((end - Date.now()) / 86400000);
  if (days < 0) return 'Plazo vencido';
  if (days === 0) return 'Cierra hoy';
  return `${days} días`;
}
