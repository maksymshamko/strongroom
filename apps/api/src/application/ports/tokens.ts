/**
 * DI tokens for every port (§1.3, §10.1). The application layer depends on these
 * symbols and the interfaces beside them — never on a concrete adapter class.
 */
export const FILE_STORAGE = Symbol('FileStorage');
export const MAILER = Symbol('Mailer');
export const PASSWORD_HASHER = Symbol('PasswordHasher');
export const TOKEN_ISSUER = Symbol('TokenIssuer');
export const CLOCK = Symbol('Clock');
export const ID_GENERATOR = Symbol('IdGenerator');
export const UNIT_OF_WORK = Symbol('UnitOfWork');
