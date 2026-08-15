import { describe, expect, it } from 'vitest';
import { decideAccess, type ShareFact, type ViewerFact } from '../../src/domain/access-decision';

const R = 'aaaaaaaa-0000-0000-0000-000000000000';
const F = 'bbbbbbbb-0000-0000-0000-000000000000';
const G = 'cccccccc-0000-0000-0000-000000000000';
const OWNER = 'owner-id';
const GRANTEE = 'grantee-id';
const STRANGER = 'stranger-id';

const roomPath = `/${R}/`;
const folderPath = `/${R}/${F}/`;
const deepPath = `/${R}/${F}/${G}/`;

const node = (path: string) => ({ path, dataRoomId: R, ownerId: OWNER });

const permissionedShareOn = (path: string, userId: string): ShareFact => ({
  shareId: 's1',
  mode: 'PERMISSIONED',
  nodePath: path,
  grantUserIds: [userId],
  token: null,
});

const linkShareOn = (path: string, token: string): ShareFact => ({
  shareId: 's2',
  mode: 'PUBLIC_LINK',
  nodePath: path,
  grantUserIds: [],
  token,
});

const viewer = (over: Partial<ViewerFact> = {}): ViewerFact => ({
  userId: null,
  ownedDataRoomIds: [],
  token: null,
  ...over,
});

// §5.2 decision rule (default-deny) and §5.4 (403 vs 404).
describe('decideAccess (§5.2)', () => {
  it('grants read and write to the data room owner', () => {
    const d = decideAccess(node(deepPath), viewer({ userId: OWNER, ownedDataRoomIds: [R] }), []);
    expect(d).toEqual({ canRead: true, canWrite: true });
  });

  it('denies everything to a stranger with no shares (default-deny)', () => {
    const d = decideAccess(node(roomPath), viewer({ userId: STRANGER }), []);
    expect(d).toEqual({ canRead: false, canWrite: false });
  });

  it('denies everything to an anonymous viewer with no token', () => {
    expect(decideAccess(node(roomPath), viewer(), [])).toEqual({ canRead: false, canWrite: false });
  });

  it('grants read — never write — to a grantee on the node itself', () => {
    const d = decideAccess(node(folderPath), viewer({ userId: GRANTEE }), [
      permissionedShareOn(folderPath, GRANTEE),
    ]);
    expect(d).toEqual({ canRead: true, canWrite: false });
  });

  it('grants read to a grantee via an ancestor share (inheritance)', () => {
    const d = decideAccess(node(deepPath), viewer({ userId: GRANTEE }), [
      permissionedShareOn(roomPath, GRANTEE),
    ]);
    expect(d.canRead).toBe(true);
  });

  it('does not grant read upward — a share on a child does not expose its parent', () => {
    const d = decideAccess(node(roomPath), viewer({ userId: GRANTEE }), [
      permissionedShareOn(deepPath, GRANTEE),
    ]);
    expect(d.canRead).toBe(false);
  });

  it('does not grant read to a different user named on the share', () => {
    const d = decideAccess(node(folderPath), viewer({ userId: STRANGER }), [
      permissionedShareOn(folderPath, GRANTEE),
    ]);
    expect(d.canRead).toBe(false);
  });

  it('grants read to a link viewer holding the matching token', () => {
    const d = decideAccess(node(deepPath), viewer({ token: 'tok-123' }), [
      linkShareOn(folderPath, 'tok-123'),
    ]);
    expect(d).toEqual({ canRead: true, canWrite: false });
  });

  it('denies a link viewer holding a non-matching token', () => {
    const d = decideAccess(node(deepPath), viewer({ token: 'wrong' }), [
      linkShareOn(folderPath, 'tok-123'),
    ]);
    expect(d.canRead).toBe(false);
  });

  it('denies a link viewer for a node outside the shared subtree (§5.6)', () => {
    const sibling = node(`/${R}/dddddddd-0000-0000-0000-000000000000/`);
    const d = decideAccess(sibling, viewer({ token: 'tok-123' }), [linkShareOn(folderPath, 'tok-123')]);
    expect(d.canRead).toBe(false);
  });

  it('denies an authenticated grantee whose share was revoked (revoked shares are not passed in)', () => {
    // Revocation is expressed by the share simply not appearing in the active set.
    const d = decideAccess(node(folderPath), viewer({ userId: GRANTEE }), []);
    expect(d.canRead).toBe(false);
  });

  it('never lets a grantee write, even on a node they can read', () => {
    const d = decideAccess(node(folderPath), viewer({ userId: GRANTEE }), [
      permissionedShareOn(roomPath, GRANTEE),
    ]);
    expect(d.canWrite).toBe(false);
  });
});

// §5.5 breadcrumb truncation.
describe('visibleBreadcrumbStart (§5.5)', () => {
  it('starts a grantee at the shared node, not the data room root', async () => {
    const { visibleBreadcrumbStart } = await import('../../src/domain/access-decision');
    const chain = [
      { id: R, path: roomPath },
      { id: F, path: folderPath },
      { id: G, path: deepPath },
    ];
    expect(
      visibleBreadcrumbStart(chain, viewer({ userId: GRANTEE }), [
        permissionedShareOn(folderPath, GRANTEE),
      ]),
    ).toBe(1);
  });

  it('starts the owner at the data room root', async () => {
    const { visibleBreadcrumbStart } = await import('../../src/domain/access-decision');
    const chain = [
      { id: R, path: roomPath },
      { id: F, path: folderPath },
    ];
    expect(visibleBreadcrumbStart(chain, viewer({ userId: OWNER, ownedDataRoomIds: [R] }), [])).toBe(
      0,
    );
  });
});
