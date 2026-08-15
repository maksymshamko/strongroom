/**
 * Shared request/response contracts for the data room API.
 * Source of truth: specs/002.data-room-mvp.md — §4 (conventions), §8 (HTTP surface).
 * Both apps/api (validation) and apps/web (typed client) import from here.
 */
export * from './primitives';
export * from './errors';
export * from './auth';
export * from './nodes';
export * from './uploads';
export * from './shares';
export * from './search';
export * from './account';
export * from './trash';
