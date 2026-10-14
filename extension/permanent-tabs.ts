export const STORAGE_KEY = 'permanentTabActions.registry';
export const SESSION_KEY = 'permanentTabActions.recordId';
export const DEFAULT_COOKIE_STORE = 'firefox-default';

export interface PermanentTabRecord {
    id: string;
    url: string;
    pinned: boolean;
    muted: boolean;
    cookieStoreId: string;
    order: number;
}

export interface PermanentTabRegistry {
    version: 1;
    nextOrder: number;
    tabs: PermanentTabRecord[];
}

type Tab = browser.tabs.Tab;

export interface BrowserApi {
    tabs: {
        query(query: browser.tabs._QueryQueryInfo): Promise<Tab[]>;
        update(tabId: number, changes: browser.tabs._UpdateUpdateProperties): Promise<Tab>;
        create(properties: browser.tabs._CreateCreateProperties): Promise<Tab>;
    };
    sessions: {
        getTabValue(tabId: number, key: string): Promise<unknown>;
        setTabValue(tabId: number, key: string, value: unknown): Promise<void>;
        removeTabValue(tabId: number, key: string): Promise<void>;
    };
    storage: {
        local: {
            get(key: string): Promise<Record<string, unknown>>;
            set(values: Record<string, unknown>): Promise<void>;
        };
    };
    cookies: {
        getAllCookieStores(): Promise<browser.cookies.CookieStore[]>;
    };
}

const emptyRegistry = (): PermanentTabRegistry => ({ version: 1, nextOrder: 0, tabs: [] });

function isRegistry(value: unknown): value is PermanentTabRegistry {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<PermanentTabRegistry>;
    return (
        candidate.version === 1 &&
        Number.isInteger(candidate.nextOrder) &&
        (candidate.nextOrder ?? -1) >= 0 &&
        Array.isArray(candidate.tabs) &&
        candidate.tabs.every(
            (tab) =>
                tab &&
                typeof tab.id === 'string' &&
                typeof tab.url === 'string' &&
                typeof tab.pinned === 'boolean' &&
                typeof tab.muted === 'boolean' &&
                typeof tab.cookieStoreId === 'string' &&
                Number.isInteger(tab.order),
        )
    );
}

function tabMuted(tab: Tab): boolean {
    return tab.mutedInfo?.muted ?? false;
}

export class PermanentTabs {
    private registry: PermanentTabRegistry = emptyRegistry();
    private queue: Promise<void> = Promise.resolve();
    private applying = new Set<number>();
    private startupTimer: ReturnType<typeof setTimeout> | undefined;
    private startupDeadline = 0;
    private startupSettling = false;

    constructor(
        private readonly api: BrowserApi,
        private readonly report: (error: unknown) => void = console.error,
    ) {}

    async initialize(): Promise<void> {
        const saved = await this.api.storage.local.get(STORAGE_KEY);
        const value = saved[STORAGE_KEY];
        if (value === undefined) {
            this.registry = emptyRegistry();
            return;
        }
        if (!isRegistry(value)) throw new Error('Unsupported or invalid permanent-tab registry.');
        this.registry = structuredClone(value);
    }

    snapshot(): PermanentTabRegistry {
        return structuredClone(this.registry);
    }

    handleUpdated(tabId: number, tab: Tab): Promise<void> {
        if (this.startupSettling || this.applying.has(tabId) || tab.incognito || tab.id === undefined) {
            return Promise.resolve();
        }
        return this.exclusive(() => this.captureTab(tab));
    }

    importExisting(): Promise<void> {
        return this.exclusive(async () => {
            const tabs = await this.api.tabs.query({ windowType: 'normal' });
            for (const tab of tabs) {
                if (!tab.incognito && (tab.pinned || tabMuted(tab))) await this.captureTab(tab);
            }
        });
    }

    startStartupReconciliation(): void {
        this.startupSettling = true;
        this.startupDeadline = Date.now() + 5000;
        this.noteStartupActivity();
    }

    noteStartupActivity(): void {
        if (!this.startupSettling) return;
        if (this.startupTimer) clearTimeout(this.startupTimer);
        const delay = Math.max(0, Math.min(500, this.startupDeadline - Date.now()));
        this.startupTimer = setTimeout(() => {
            this.startupTimer = undefined;
            this.startupSettling = false;
            void this.reconcile().catch(this.report);
        }, delay);
    }

    reconcile(): Promise<void> {
        return this.exclusive(async () => {
            const openTabs = (await this.api.tabs.query({ windowType: 'normal' })).filter(
                (tab) => !tab.incognito && tab.id !== undefined,
            );
            const records = new Map(this.registry.tabs.map((record) => [record.id, record]));
            const claimed = new Set<string>();
            const unassociated: Tab[] = [];

            for (const tab of openTabs) {
                const recordId = await this.getRecordId(tab.id!);
                const record = recordId ? records.get(recordId) : undefined;
                if (!record || claimed.has(record.id)) {
                    unassociated.push(tab);
                    continue;
                }
                claimed.add(record.id);
                await this.applyRecord(tab.id!, tab, record);
            }

            const unmatched = this.registry.tabs.filter((record) => !claimed.has(record.id));
            for (const tab of unassociated) {
                const match = unmatched.find(
                    (record) =>
                        !claimed.has(record.id) &&
                        record.url === tab.url &&
                        record.cookieStoreId === (tab.cookieStoreId ?? DEFAULT_COOKIE_STORE),
                );
                if (!match) continue;
                claimed.add(match.id);
                await this.api.sessions.setTabValue(tab.id!, SESSION_KEY, match.id);
                await this.applyRecord(tab.id!, tab, match);
            }

            const targetWindowId = openTabs[0]?.windowId;
            if (targetWindowId === undefined) return;

            const stores = await this.availableCookieStores();
            let changed = false;
            for (const record of this.registry.tabs
                .filter((item) => !claimed.has(item.id))
                .sort((a, b) => a.order - b.order)) {
                try {
                    let cookieStoreId = record.cookieStoreId;
                    if (!stores.has(cookieStoreId)) {
                        cookieStoreId = DEFAULT_COOKIE_STORE;
                        record.cookieStoreId = cookieStoreId;
                        changed = true;
                    }
                    const created = await this.api.tabs.create({
                        windowId: targetWindowId,
                        url: record.url,
                        cookieStoreId,
                        pinned: record.pinned,
                        active: false,
                    });
                    if (created.id === undefined) continue;
                    await this.api.sessions.setTabValue(created.id, SESSION_KEY, record.id);
                    await this.applyRecord(created.id, created, record);
                } catch (error) {
                    this.report(error);
                }
            }
            if (changed) await this.save();
        });
    }

    private exclusive(work: () => Promise<void>): Promise<void> {
        const result = this.queue.then(work);
        this.queue = result.catch(this.report);
        return result;
    }

    private async captureTab(tab: Tab): Promise<void> {
        if (tab.id === undefined || tab.incognito) return;
        const active = tab.pinned || tabMuted(tab);
        const recordId = await this.getRecordId(tab.id);
        const index = recordId ? this.registry.tabs.findIndex((record) => record.id === recordId) : -1;

        if (!active) {
            if (index < 0) return;
            this.registry.tabs.splice(index, 1);
            await this.api.sessions.removeTabValue(tab.id, SESSION_KEY).catch(() => {});
            await this.save();
            return;
        }

        if (!tab.url) return;
        if (index >= 0) {
            const record = this.registry.tabs[index];
            record.url = tab.url;
            record.pinned = tab.pinned;
            record.muted = tabMuted(tab);
            record.cookieStoreId = tab.cookieStoreId ?? DEFAULT_COOKIE_STORE;
        } else {
            const id = crypto.randomUUID();
            this.registry.tabs.push({
                id,
                url: tab.url,
                pinned: tab.pinned,
                muted: tabMuted(tab),
                cookieStoreId: tab.cookieStoreId ?? DEFAULT_COOKIE_STORE,
                order: this.registry.nextOrder++,
            });
            await this.api.sessions.setTabValue(tab.id, SESSION_KEY, id);
        }
        await this.save();
    }

    private async applyRecord(tabId: number, tab: Tab, record: PermanentTabRecord): Promise<void> {
        if (tab.pinned === record.pinned && tabMuted(tab) === record.muted) return;
        this.applying.add(tabId);
        try {
            await this.api.tabs.update(tabId, { pinned: record.pinned, muted: record.muted });
        } finally {
            setTimeout(() => this.applying.delete(tabId), 0);
        }
    }

    private async getRecordId(tabId: number): Promise<string | undefined> {
        try {
            const value = await this.api.sessions.getTabValue(tabId, SESSION_KEY);
            return typeof value === 'string' ? value : undefined;
        } catch {
            return undefined;
        }
    }

    private async availableCookieStores(): Promise<Set<string>> {
        try {
            const stores = await this.api.cookies.getAllCookieStores();
            return new Set([DEFAULT_COOKIE_STORE, ...stores.map((store) => store.id)]);
        } catch {
            return new Set([DEFAULT_COOKIE_STORE]);
        }
    }

    private save(): Promise<void> {
        return this.api.storage.local.set({ [STORAGE_KEY]: this.registry });
    }
}
