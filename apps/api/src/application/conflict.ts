import { suggestFreeName } from '../domain/conflict-resolver';
import { DomainError } from '../domain/errors';
import type { NodeType } from '../domain/node-type';
import type { NodeRecord, NodeRepository } from './ports/repositories';

export type Resolution = 'KEEP_BOTH' | 'NEW_VERSION' | 'REPLACE';

export type ConflictCheck =
  | { kind: 'FREE'; name: string }
  | { kind: 'RESOLVED'; name: string; resolution: Resolution; existing: NodeRecord }
  | { kind: 'BLOCKED'; existing: NodeRecord; suggestedName: string; versioningAvailable: boolean };

/**
 * §6.4 — one conflict mechanism serving upload, rename and move.
 *
 * The resolution decision belongs to the client (that is where the dialog is),
 * so a conflict without `onConflict` is reported rather than guessed at, and
 * nothing is written.
 */
export async function checkConflict(
  nodes: NodeRepository,
  parentId: string,
  desiredName: string,
  incomingType: NodeType,
  resolution: Resolution | undefined,
  ignoreNodeId?: string,
): Promise<ConflictCheck> {
  const existing = await nodes.findChildByName(parentId, desiredName);
  if (!existing || existing.id === ignoreNodeId) return { kind: 'FREE', name: desiredName };

  // §6.1 — conflicts are detected across any type pair, but only a FILE+FILE
  // pair can be resolved by versioning. A folder cannot become a file's version.
  const versioningAvailable = existing.type === 'FILE' && incomingType === 'FILE';

  if (!resolution) {
    const siblings = await nodes.childNames(parentId);
    return {
      kind: 'BLOCKED',
      existing,
      suggestedName: suggestFreeName(desiredName, siblings, incomingType),
      versioningAvailable,
    };
  }

  if (resolution === 'KEEP_BOTH') {
    const siblings = await nodes.childNames(parentId);
    return {
      kind: 'RESOLVED',
      name: suggestFreeName(desiredName, siblings, incomingType),
      resolution,
      existing,
    };
  }

  if (!versioningAvailable) {
    throw DomainError.validation(
      `"${resolution}" only applies when both the incoming and existing items are files`,
    );
  }

  return { kind: 'RESOLVED', name: desiredName, resolution, existing };
}

export function conflictError(check: Extract<ConflictCheck, { kind: 'BLOCKED' }>): DomainError {
  return new DomainError('NAME_CONFLICT', `An item named "${check.existing.name}" already exists here`, {
    conflictingNodeId: check.existing.id,
    conflictingNodeType: check.existing.type,
    suggestedName: check.suggestedName,
    versioningAvailable: check.versioningAvailable,
  });
}
