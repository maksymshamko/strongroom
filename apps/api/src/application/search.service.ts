import { DomainError } from '../domain/errors';
import { NodePath } from '../domain/node-path';
import { AccessService, type Viewer } from './access.service';
import type {
  ListOptions,
  NodeRecord,
  SearchFilters,
  UnitOfWork,
} from './ports/repositories';

export type SearchHit = NodeRecord & { pathLabel: string };

export class SearchService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly access: AccessService,
  ) {}

  // §8.5 GET /nodes/{id}/search
  async search(
    viewer: Viewer,
    rootId: string,
    filters: SearchFilters,
    opts: ListOptions,
  ): Promise<{ items: SearchHit[]; hasMore: boolean }> {
    return this.uow.read(async (repos) => {
      const { facts, shares } = await this.access.resolve(repos, viewer);
      const root = await repos.nodes.findById(rootId);
      if (!root) throw DomainError.notFound('Node');
      this.access.assertRead(root, facts, shares);

      const rows = await repos.nodes.searchSubtree(root.path, filters, {
        ...opts,
        limit: opts.limit + 1,
        // spec 003 §2.8 — deleted material never appears in search results.
        excludeDeleted: true,
      });
      const hasMore = rows.length > opts.limit;
      const page = hasMore ? rows.slice(0, opts.limit) : rows;

      // pathLabel is the human folder trail (design §8.2), expressed relative to
      // the searched root. Because the root is itself access-checked above, a
      // grantee never learns the names of folders above what they were shared
      // (§5.5) — the trail simply cannot reach them.
      const ancestorIds = new Set<string>();
      for (const row of page) {
        for (const id of NodePath.parse(row.path).ancestorIds) ancestorIds.add(id);
      }
      const ancestors = new Map(
        (await repos.nodes.findByIds([...ancestorIds])).map((n) => [n.id, n]),
      );

      const rootDepth = NodePath.parse(root.path).depth;
      const items = page.map((row) => {
        const trail = NodePath.parse(row.path)
          .ancestorIds.slice(rootDepth)
          .map((id) => ancestors.get(id)?.name)
          .filter((n): n is string => Boolean(n));
        return { ...row, pathLabel: trail.join(' / ') };
      });

      return { items, hasMore };
    });
  }
}
