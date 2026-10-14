import { PermanentTabs } from './permanent-tabs';

const permanentTabs = new PermanentTabs(browser);
const ready = permanentTabs.initialize().catch((error) => {
    console.error('Permanent Tab Actions could not initialize:', error);
    throw error;
});

browser.tabs.onUpdated.addListener(
    (tabId, _changeInfo, tab) => {
        void ready.then(() => permanentTabs.handleUpdated(tabId, tab)).catch(console.error);
    },
    { properties: ['pinned', 'mutedInfo', 'url'] },
);

browser.tabs.onCreated.addListener(() => permanentTabs.noteStartupActivity());
browser.windows.onCreated.addListener(() => permanentTabs.noteStartupActivity());

browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') void ready.then(() => permanentTabs.importExisting()).catch(console.error);
});

browser.runtime.onStartup.addListener(() => {
    void ready.then(() => permanentTabs.startStartupReconciliation()).catch(console.error);
});
