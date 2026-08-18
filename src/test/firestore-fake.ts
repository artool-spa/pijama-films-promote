/**
 * In-memory stand-in for the Firestore Admin SDK.
 *
 * The billing model is the one place where a wrong write costs money, so its
 * behaviour — balance arithmetic, idempotency, ordering — is worth testing for
 * real rather than asserting that some mock was called. This implements the
 * slice of the API the models use, over a plain `Map` keyed by document path.
 *
 * It is deliberately not a Firestore emulator: there is no isolation, no
 * contention and no retry. Transaction callbacks run once and their writes are
 * applied on commit, which is enough to exercise read-then-write logic.
 */

type Data = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function get(data: Data, field: string): unknown {
  return field.split('.').reduce<unknown>((acc, key) => {
    return acc && typeof acc === 'object' ? (acc as Data)[key] : undefined;
  }, data);
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

interface Filter {
  field: string;
  op: string;
  value: unknown;
}

function matches(data: Data, filter: Filter): boolean {
  const actual = get(data, filter.field);

  switch (filter.op) {
    case '==':
      return actual instanceof Date && filter.value instanceof Date
        ? actual.getTime() === filter.value.getTime()
        : actual === filter.value;
    case '!=':
      return actual !== filter.value;
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(actual);
    case 'array-contains':
      return Array.isArray(actual) && actual.includes(filter.value);
    case '<':
      return compare(actual, filter.value) < 0;
    case '>':
      return compare(actual, filter.value) > 0;
    default:
      throw new Error(`FakeFirestore: unsupported operator ${filter.op}`);
  }
}

export class FakeSnapshot {
  constructor(
    readonly id: string,
    private readonly stored: Data | undefined,
    readonly ref: FakeDocRef
  ) {}

  get exists(): boolean {
    return this.stored !== undefined;
  }

  data(): Data | undefined {
    return this.stored === undefined ? undefined : clone(this.stored);
  }
}

export class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    readonly path: string
  ) {}

  get id(): string {
    return this.path.split('/').pop() as string;
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }

  snapshot(): FakeSnapshot {
    return new FakeSnapshot(this.id, this.db.store.get(this.path), this);
  }

  async get(): Promise<FakeSnapshot> {
    return this.snapshot();
  }

  async set(data: Data, options?: { merge?: boolean }): Promise<void> {
    this.db.write(this.path, data, options?.merge ?? false);
  }

  async update(data: Data): Promise<void> {
    if (!this.db.store.has(this.path)) {
      throw new Error(`FakeFirestore: no document to update at ${this.path}`);
    }
    this.db.write(this.path, data, true);
  }

  async delete(): Promise<void> {
    this.db.store.delete(this.path);
  }
}

export class FakeQuery {
  constructor(
    private readonly db: FakeFirestore,
    private readonly scope: { basePath?: string; group?: string },
    private readonly filters: Filter[] = [],
    private readonly order?: { field: string; dir: 'asc' | 'desc' },
    private readonly limitCount?: number,
    private readonly offsetCount = 0
  ) {}

  private derive(patch: Partial<{ filters: Filter[]; order: { field: string; dir: 'asc' | 'desc' }; limitCount: number; offsetCount: number }>): FakeQuery {
    return new FakeQuery(
      this.db,
      this.scope,
      patch.filters ?? this.filters,
      patch.order ?? this.order,
      patch.limitCount ?? this.limitCount,
      patch.offsetCount ?? this.offsetCount
    );
  }

  where(field: string, op: string, value: unknown): FakeQuery {
    return this.derive({ filters: [...this.filters, { field, op, value }] });
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): FakeQuery {
    return this.derive({ order: { field, dir } });
  }

  limit(count: number): FakeQuery {
    return this.derive({ limitCount: count });
  }

  offset(count: number): FakeQuery {
    return this.derive({ offsetCount: count });
  }

  private inScope(path: string): boolean {
    const segments = path.split('/');

    if (this.scope.group) {
      return segments.length >= 2 && segments[segments.length - 2] === this.scope.group;
    }

    const base = this.scope.basePath as string;
    return path.startsWith(`${base}/`) && path.slice(base.length + 1).split('/').length === 1;
  }

  private rows(): { path: string; data: Data }[] {
    let rows = [...this.db.store.entries()]
      .filter(([path]) => this.inScope(path))
      .map(([path, data]) => ({ path, data }))
      .filter(({ data }) => this.filters.every((filter) => matches(data, filter)));

    if (this.order) {
      const { field, dir } = this.order;
      rows = rows.sort((a, b) => {
        const result = compare(get(a.data, field), get(b.data, field));
        return dir === 'desc' ? -result : result;
      });
    }

    rows = rows.slice(this.offsetCount);

    return this.limitCount === undefined ? rows : rows.slice(0, this.limitCount);
  }

  async get(): Promise<{ docs: FakeSnapshot[]; empty: boolean; size: number }> {
    const docs = this.rows().map(
      ({ path, data }) => new FakeSnapshot(path.split('/').pop() as string, data, new FakeDocRef(this.db, path))
    );

    return { docs, empty: docs.length === 0, size: docs.length };
  }

  count() {
    return {
      get: async () => ({ data: () => ({ count: this.rows().length }) }),
    };
  }

  aggregate(spec: Record<string, { field?: string; kind: string }>) {
    return {
      get: async () => ({
        data: () => {
          const rows = this.rows();
          const out: Record<string, number> = {};
          for (const [alias, aggregate] of Object.entries(spec)) {
            out[alias] =
              aggregate.kind === 'count'
                ? rows.length
                : rows.reduce((total, { data }) => total + Number(get(data, aggregate.field as string) ?? 0), 0);
          }
          return out;
        },
      }),
    };
  }
}

export class FakeCollection extends FakeQuery {
  constructor(
    private readonly database: FakeFirestore,
    private readonly basePath: string
  ) {
    super(database, { basePath });
  }

  doc(id?: string): FakeDocRef {
    return new FakeDocRef(this.database, `${this.basePath}/${id ?? this.database.newId()}`);
  }
}

class FakeWriteBuffer {
  protected readonly writes: (() => void)[] = [];

  constructor(protected readonly db: FakeFirestore) {}

  set(ref: FakeDocRef, data: Data, options?: { merge?: boolean }): void {
    const snapshot = clone(data);
    this.writes.push(() => this.db.write(ref.path, snapshot, options?.merge ?? false));
  }

  update(ref: FakeDocRef, data: Data): void {
    const snapshot = clone(data);
    this.writes.push(() => this.db.write(ref.path, snapshot, true));
  }

  delete(ref: FakeDocRef): void {
    this.writes.push(() => this.db.store.delete(ref.path));
  }

  flush(): void {
    for (const write of this.writes) write();
    this.writes.length = 0;
  }
}

export class FakeTransaction extends FakeWriteBuffer {
  async get(target: FakeDocRef | FakeQuery) {
    return target.get();
  }
}

export class FakeBatch extends FakeWriteBuffer {
  async commit(): Promise<void> {
    this.flush();
  }
}

export class FakeFirestore {
  readonly store = new Map<string, Data>();
  private counter = 0;

  newId(): string {
    this.counter += 1;
    // Monotonic so that auto-id ordering matches insertion order in tests.
    return `doc${String(this.counter).padStart(4, '0')}`;
  }

  write(path: string, data: Data, merge: boolean): void {
    const next = merge ? { ...(this.store.get(path) ?? {}), ...clone(data) } : clone(data);
    this.store.set(path, next);
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this, name);
  }

  collectionGroup(name: string): FakeQuery {
    return new FakeQuery(this, { group: name });
  }

  async getAll(...refs: FakeDocRef[]): Promise<FakeSnapshot[]> {
    return refs.map((ref) => ref.snapshot());
  }

  batch(): FakeBatch {
    return new FakeBatch(this);
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const tx = new FakeTransaction(this);
    const result = await fn(tx);
    tx.flush();
    return result;
  }

  reset(): void {
    this.store.clear();
    this.counter = 0;
  }
}
