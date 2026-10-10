/**
 * Type-level tools for the contract checks (spec 4.1). No runtime code.
 *
 * Diff<From, To> is a union of messages, one per reason a value of type From
 * is not a valid To, or `never` when From is assignable to To:
 *   reads   Diff<SpecReply, CafaiType>  what Decaid may send must fit what CafAI expects
 *   writes  Diff<CafaiBody, SpecBody>   what CafAI sends must fit what Decaid documents
 * Extra<From, To> lists the keys From has and To does not declare (writes).
 * Exactly<Actual, Known> is true only when a diff equals its recorded
 * exceptions in drift.ts: a new mismatch fails as { unexpected }, a fixed one
 * as { stale }.
 *
 * The accessors read the generated types by path, method and status, never by
 * schema name, so a renamed schema with the same shape changes nothing. The
 * generated files come in through the #decaid/rest and #decaid/ws aliases
 * (tsconfig.contract.json), which the drift watch points at a newer Decaid.
 *
 * Ported from the type experiment (docs/audit/2026-10-09/typegen.md, section 3).
 */
import type { components, paths } from '#decaid/rest';
import type { components as wsComponents, WsReceive, WsSend } from '#decaid/ws';

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> = IsAny<T> extends true ? false : unknown extends T ? true : false;
type IsNever<T> = [T] extends [never] ? true : false;

/** Declared string keys, without index signatures. */
export type KnownKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: 0;
} & string;
/** The empty object fits Pick<T, K> only when K is optional. */
type IsOptional<T, K extends keyof T> = Record<never, never> extends Pick<T, K> ? true : false;
type HasStringIndex<T> = string extends keyof T ? true : false;

/** Primitives, including the `string & {}` of CafAI's open unions, which TypeScript would also count as an object. */
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Arr<T> = T extends readonly (infer E)[] ? E : never;
type Obj<T> = T extends readonly unknown[] ? never : T extends Primitive ? never : T extends object ? T : never;
type Prim<T> = T extends Primitive ? T : never;
type Def<T> = Exclude<T, undefined>;

type Lit<T> = T extends string
  ? string extends T ? 'string' : `'${T}'`
  : T extends number ? number extends T ? 'number' : `${T}`
  : T extends boolean ? 'boolean'
  : 'other';

/** One message per primitive member of From (null included) that To rejects. */
type PrimDiff<F, T, P extends string> = F extends unknown
  ? [F] extends [T] ? never : F extends null ? `${P}: null not accepted` : `${P}: ${Lit<F>} not accepted`
  : never;

type FieldDiff<F, T, P extends string> =
  IsNever<F> extends true ? `${P}: not in the spec`
  : IsAny<F> extends true ? never
  : IsUnknown<T> extends true ? never
  : IsUnknown<F> extends true ? `${P}: untyped (unknown) in source`
  : [F] extends [T] ? never
  : | PrimDiff<Prim<F>, T, P>
    | (IsNever<Arr<F>> extends true ? never
        : IsNever<Arr<T>> extends true ? `${P}: array not accepted`
        : FieldDiff<Arr<F>, Arr<T>, `${P}[]`>)
    | (IsNever<Obj<F>> extends true ? never
        : IsNever<Obj<T>> extends true ? `${P}: object not accepted`
        : [Obj<F>] extends [Obj<T>] ? never
        : ObjectDiff<Obj<F>, Obj<T>, `${P}.`>);

type ObjectDiff<F, T, P extends string> = {
  [K in KnownKeys<T>]-?: K extends KnownKeys<F>
    ? | (IsOptional<T, K> extends true ? never
          : IsOptional<F, K & keyof F> extends true ? `${P}${K}: optional in source, required in target` : never)
      | FieldDiff<Def<F[K & keyof F]>, Def<T[K]>, `${P}${K}`>
    : IsOptional<T, K> extends true ? `${P}${K}: absent in source (optional in target)` : `${P}${K}: absent in source`;
}[KnownKeys<T>];

/** A route, method or status the spec lost reads as `never`: say so instead of passing. */
export type Diff<F, T, P extends string = ''> =
  IsNever<F> extends true ? `${P}(source): not in the spec`
  : IsNever<T> extends true ? `${P}(target): not in the spec`
  : ObjectDiff<F, T, P>;

export type Extra<F, T, P extends string = ''> = HasStringIndex<T> extends true ? never : {
  [K in KnownKeys<F>]-?: K extends KnownKeys<T>
    ? IsNever<Obj<Def<F[K]>>> extends true ? never
      : IsNever<Obj<Def<T[K & keyof T]>>> extends true ? never
      : Extra<Obj<Def<F[K]>>, Obj<Def<T[K & keyof T]>>, `${P}${K}.`>
    : `${P}${K}: not declared by target`;
}[KnownKeys<F>];

/** The literal members of an open union like 'a' | 'b' | (string & {}). */
export type Known<T> = T extends string ? (string extends T ? never : T) : never;
/** Values one side lists that the other does not. */
export type EnumDrift<Spec extends string, Ours extends string> =
  | (Exclude<Spec, Known<Ours>> extends infer X extends string ? IsNever<X> extends true ? never : `spec only: ${X}` : never)
  | (Exclude<Known<Ours>, Spec> extends infer Y extends string ? IsNever<Y> extends true ? never : `CafAI only: ${Y}` : never);

/** Writes: leaving out a field the target has as optional is fine. */
export type W<T extends string> = Exclude<T, `${string}: absent in source (optional in target)`>;

export type Exactly<Actual extends string, KnownDrift extends string> =
  [Exclude<Actual, KnownDrift>] extends [never]
    ? [Exclude<KnownDrift, Actual>] extends [never] ? true : { stale: Exclude<KnownDrift, Actual> }
    : { unexpected: Exclude<Actual, KnownDrift> };
export type Assert<T extends true> = T;

// ---------------------------------------------------------------------------
// Path accessors into the generated types
// ---------------------------------------------------------------------------

type Json<C> = C extends { content: { 'application/json': infer B } } ? B : never;
type Op<P extends keyof paths, M extends string> = M extends keyof paths[P] ? paths[P][M] : never;
/** The JSON body of response S of method M on path P. */
export type Res<P extends keyof paths, M extends string, S extends number = 200> =
  Op<P, M> extends { responses: infer R } ? (S extends keyof R ? Json<R[S]> : never) : never;
/** The status codes the spec documents for an operation. */
export type Statuses<P extends keyof paths, M extends string> = Op<P, M> extends { responses: infer R } ? keyof R : never;
/** The JSON request body of method M on path P. */
export type Body<P extends keyof paths, M extends string> =
  Op<P, M> extends { requestBody?: infer B } ? Json<NonNullable<B>> : never;
/** The path parameters of method M on path P. */
export type PathParams<P extends keyof paths, M extends string> =
  Op<P, M> extends { parameters: { path: infer X } } ? X : never;

export type Rest = components['schemas'];
export type Ws = wsComponents['schemas'];
export type { WsReceive, WsSend, paths };
