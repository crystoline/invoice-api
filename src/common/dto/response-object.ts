/**
 * The ubiquitous Spring `ResponseObject<T>` envelope:
 *   { responseCode, message, data }
 *
 * Crucially, the Spring controllers return this object directly (not a
 * ResponseEntity), so the HTTP status is ALWAYS 200 — logical failures are
 * signalled by responseCode "01" (success = "00"). The port preserves that.
 */
export interface ResponseObject<T = unknown> {
  responseCode: string;
  message: string;
  data: T | null;
}

export function ok<T>(message: string, data: T | null = null): ResponseObject<T> {
  return { responseCode: '00', message, data };
}

export function fail<T = null>(message: string, data: T | null = null): ResponseObject<T> {
  return { responseCode: '01', message, data };
}
