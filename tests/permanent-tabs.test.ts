import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_COOKIE_STORE,
    PermanentTabs,
    SESSION_KEY,
    STORAGE_KEY,
    type BrowserApi,
    type PermanentTabRegistry,
} from '../extension/permanent-tabs';

type Tab = browser.tabs.Tab;

class Fixture {
    tabs: Tab[] = [];
    stored: Record<string, unknown> = {};
    session = new Map<number, string>();
    stores = new Set([DEFAULT_COOKIE_STORE, 'firefox-container-1']);
    updates: Array<{ id: number; pinned?: boolean; muted?: boolean }> = [];
    creates: browser.tabs._CreateCreateProperties[] = [];
    failures = new Set<string>();
    nextId = 100;

    api: BrowserApi = {
        tabs: {
            query: vi.fn(async () => this.tabs.map((tab) => structuredClone(tab))),
            update: vi.fn(async (id, changes) => {
                const tab = this.tabs.find((item) => item.id === id);
                if (!tab) throw new Error('Missing tab');
                if (changes.pinned !== undefined) tab.pinned = changes.pinned;
                if (changes.muted !== undefined) tab.mutedInfo = { muted: changes.muted };
                this.updates.push({ id: id!, pinned: changes.pinned, muted: changes.muted });
                return structuredClone(tab);
            }),
            create: vi.fn(async (properties) => {
                if (this.failures.has(String(properties.url))) throw new Error('Cannot restore URL');
                this.creates.push(structuredClone(properties));
                const tab = makeTab(this.nextId++, {
                    url: String(properties.url),
                    windowId: properties.windowId ?? 1,
                    pinned: properties.pinned ?? false,
                    cookieStoreId: properties.cookieStoreId ?? DEFAULT_COOKIE_STORE,
                });
                this.tabs.push(tab);
                return structuredClone(tab);
            }),
        },
        sessions: {
            getTabValue: vi.fn(async (id) => this.session.get(id)),
            setTabValue: vi.fn(async (id, key, value) => {
                expect(key).toBe(SESSION_KEY);
                this.session.set(id, String(value));
            }),
            removeTabValue: vi.fn(async (id) => {
                this.session.delete(id);
            }),
        },
        storage: {
            local: {
                get: vi.fn(async () => structuredClone(this.stored)),
                set: vi.fn(async (values) => Object.assign(this.stored, structuredClone(values))),
            },
        },
        cookies: {
            getAllCookieStores: vi.fn(async () =>
                [...this.stores].map((id) => ({ id, tabIds: [], incognito: false })),
            ),
        },
    };
}

function makeTab(id: number, overrides: Partial<Tab> = {}): Tab {
    return {
        id,
        index: id,
        windowId: 1,
        highlighted: false,
        active: false,
        pinned: false,
        incognito: false,
        discarded: false,
        hidden: false,
        autoDiscardable: true,
        isArticle: false,
        status: 'complete',
        url: `https://example.com/${id}`,
        cookieStoreId: DEFAULT_COOKIE_STORE,
        mutedInfo: { muted: false },
        ...overrides,
    };
}

function registry(tabs: PermanentTabRegistry['tabs']): PermanentTabRegistry {
    return { version: 1, nextOrder: tabs.length, tabs };
}

function record(id: string, url: string, overrides: Partial<PermanentTabRegistry['tabs'][number]> = {}) {
    return {
        id,
        url,
        pinned: true,
        muted: false,
        cookieStoreId: DEFAULT_COOKIE_STORE,
        order: 0,
        ...overrides,
    };
}

describe('PermanentTabs', () => {
    let fixture: Fixture;
    let manager: PermanentTabs;

    beforeEach(async () => {
        fixture = new Fixture();
        manager = new PermanentTabs(fixture.api, () => {});
        await manager.initialize();
    });

    it('registers pin and mute actions, tracks navigation, and removes only after both clear', async () => {
        const tab = makeTab(1, { pinned: true });
        await manager.handleUpdated(1, tab);
        const first = manager.snapshot().tabs[0];
        expect(first).toMatchObject({ url: tab.url, pinned: true, muted: false });
        expect(fixture.session.get(1)).toBe(first.id);

        tab.url = 'https://example.com/latest';
        tab.pinned = false;
        tab.mutedInfo = { muted: true };
        await manager.handleUpdated(1, tab);
        expect(manager.snapshot().tabs[0]).toMatchObject({ url: tab.url, pinned: false, muted: true });

        tab.mutedInfo = { muted: false };
        await manager.handleUpdated(1, tab);
        expect(manager.snapshot().tabs).toEqual([]);
        expect(fixture.session.has(1)).toBe(false);
    });

    it('imports existing pinned and muted tabs but ignores private tabs', async () => {
        fixture.tabs = [
            makeTab(1, { pinned: true }),
            makeTab(2, { mutedInfo: { muted: true } }),
            makeTab(3, { pinned: true, incognito: true }),
            makeTab(4),
        ];
        await manager.importExisting();
        expect(manager.snapshot().tabs.map((item) => item.url)).toEqual([
            'https://example.com/1',
            'https://example.com/2',
        ]);
    });

    it('serializes simultaneous registrations without losing records', async () => {
        await Promise.all([
            manager.handleUpdated(1, makeTab(1, { pinned: true })),
            manager.handleUpdated(2, makeTab(2, { mutedInfo: { muted: true } })),
        ]);
        expect(manager.snapshot().tabs.map((item) => item.url)).toEqual([
            'https://example.com/1',
            'https://example.com/2',
        ]);
    });

    it('reassociates restored tabs by session identity and enforces saved state', async () => {
        const saved = record('one', 'https://example.com/one', { muted: true });
        fixture.stored[STORAGE_KEY] = registry([saved]);
        fixture.tabs = [makeTab(8, { url: saved.url })];
        fixture.session.set(8, saved.id);
        manager = new PermanentTabs(fixture.api, () => {});
        await manager.initialize();
        await manager.reconcile();
        expect(fixture.creates).toHaveLength(0);
        expect(fixture.updates).toEqual([{ id: 8, pinned: true, muted: true }]);
    });

    it('matches exact URL and container before creating a duplicate', async () => {
        const saved = record('one', 'https://example.com/same', { cookieStoreId: 'firefox-container-1' });
        fixture.stored[STORAGE_KEY] = registry([saved]);
        fixture.tabs = [makeTab(3, { url: saved.url, cookieStoreId: 'firefox-container-1' })];
        manager = new PermanentTabs(fixture.api, () => {});
        await manager.initialize();
        await manager.reconcile();
        expect(fixture.creates).toHaveLength(0);
        expect(fixture.session.get(3)).toBe('one');
    });

    it('preserves separate records with identical URLs', async () => {
        const url = 'https://example.com/same';
        fixture.stored[STORAGE_KEY] = registry([
            record('one', url, { order: 0 }),
            record('two', url, { order: 1 }),
        ]);
        fixture.tabs = [makeTab(1, { url: 'about:blank' })];
        manager = new PermanentTabs(fixture.api, () => {});
        await manager.initialize();
        await manager.reconcile();
        expect(fixture.creates.map((item) => item.url)).toEqual([url, url]);
        expect(new Set([...fixture.session.values()])).toEqual(new Set(['one', 'two']));
    });

    it('falls back to the default container and persists the repair', async () => {
        const saved = record('one', 'https://example.com/container', { cookieStoreId: 'firefox-container-missing' });
        fixture.stored[STORAGE_KEY] = registry([saved]);
        fixture.tabs = [makeTab(1, { url: 'about:blank' })];
        manager = new PermanentTabs(fixture.api, () => {});
        await manager.initialize();
        await manager.reconcile();
        expect(fixture.creates[0].cookieStoreId).toBe(DEFAULT_COOKIE_STORE);
        expect(manager.snapshot().tabs[0].cookieStoreId).toBe(DEFAULT_COOKIE_STORE);
    });

    it('is idempotent when startup reconciliation runs more than once', async () => {
        const saved = record('one', 'https://example.com/once');
        fixture.stored[STORAGE_KEY] = registry([saved]);
        fixture.tabs = [makeTab(1, { url: 'about:blank' })];
        manager = new PermanentTabs(fixture.api, () => {});
        await manager.initialize();
        await manager.reconcile();
        await manager.reconcile();
        expect(fixture.creates).toHaveLength(1);
    });

    it('retains failed records and continues restoring the others', async () => {
        const broken = 'about:preferences';
        const working = 'https://example.com/working';
        fixture.stored[STORAGE_KEY] = registry([
            record('broken', broken, { order: 0 }),
            record('working', working, { order: 1 }),
        ]);
        fixture.tabs = [makeTab(1, { url: 'about:blank' })];
        fixture.failures.add(broken);
        manager = new PermanentTabs(fixture.api, () => {});
        await manager.initialize();
        await manager.reconcile();
        expect(fixture.creates.map((item) => item.url)).toEqual([working]);
        expect(manager.snapshot().tabs).toHaveLength(2);
    });

    it('rejects unknown registry versions without modifying storage', async () => {
        fixture.stored[STORAGE_KEY] = { version: 2, tabs: [] };
        manager = new PermanentTabs(fixture.api, () => {});
        await expect(manager.initialize()).rejects.toThrow('Unsupported or invalid');
        expect(fixture.api.storage.local.set).not.toHaveBeenCalled();
    });
});
