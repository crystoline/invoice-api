import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  AUTHENTICATED_KEY,
  BUSINESS_POLICY_KEY,
  BusinessPolicy,
} from './authz.decorators';

/**
 * Every route must declare who may call it — the runtime guard refuses any
 * that don't, and this test catches them before deploy. It also checks that a
 * business policy only names `:params` the route actually has.
 */

type Ctor = { name: string; prototype: Record<string, unknown> };

const SRC = join(__dirname, '..', '..');

const controllerFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return controllerFiles(p);
    return name.endsWith('.controller.ts') ? [p] : [];
  });

interface Route {
  id: string;
  path: string;
  meta: (key: string) => unknown;
}

const routes: Route[] = controllerFiles(SRC).flatMap((file) =>
  // Loading every controller file dynamically is the point of this test.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Object.values(require(file) as Record<string, unknown>)
    .filter(
      (v): v is Ctor =>
        typeof v === 'function' &&
        Reflect.hasMetadata(PATH_METADATA, v as object),
    )
    .flatMap((ctrl) => {
      const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
      return Object.getOwnPropertyNames(ctrl.prototype)
        .filter((m) => m !== 'constructor')
        .map((m) => ctrl.prototype[m] as object)
        .filter((h) => Reflect.hasMetadata(METHOD_METADATA, h))
        .map((handler) => {
          const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
          return {
            id: `${ctrl.name}.${(handler as { name: string }).name}`,
            path: `/${base}/${sub}`.replace(/\/+/g, '/'),
            meta: (key: string): unknown =>
              (Reflect.getMetadata(key, handler) as unknown) ??
              (Reflect.getMetadata(key, ctrl) as unknown),
          };
        });
    }),
);

describe('route access policies', () => {
  it('finds the API surface', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('every route declares an access policy', () => {
    const missing = routes
      .filter(
        (r) =>
          !r.meta(IS_PUBLIC_KEY) &&
          !(r.meta(ROLES_KEY) as unknown[] | undefined)?.length &&
          !r.meta(AUTHENTICATED_KEY) &&
          !r.meta(BUSINESS_POLICY_KEY),
      )
      .map((r) => `${r.id} ${r.path}`);
    expect(missing).toEqual([]);
  });

  it('business policies only name params their route has', () => {
    const wrong = routes.flatMap((r) => {
      const policy = r.meta(BUSINESS_POLICY_KEY) as BusinessPolicy | undefined;
      if (!policy) return [];
      const names = [policy.scope.param, policy.scope.idParam].filter(
        (n): n is string => !!n,
      );
      return names
        .filter((n) => !r.path.split('/').includes(`:${n}`))
        .map((n) => `${r.id} ${r.path} has no :${n}`);
    });
    expect(wrong).toEqual([]);
  });

  it('a business policy says where the business comes from', () => {
    const vague = routes
      .filter((r) => {
        const s = (r.meta(BUSINESS_POLICY_KEY) as BusinessPolicy | undefined)
          ?.scope;
        if (!s) return false;
        const direct = s.param ?? s.query ?? s.body;
        const viaRecord = s.resource && (s.idParam ?? s.idBody);
        return !direct && !viaRecord;
      })
      .map((r) => r.id);
    expect(vague).toEqual([]);
  });
});
