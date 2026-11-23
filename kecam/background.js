'use strict';

const DEFAULT_RULES = [
  { on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 7000 }, { field: 'contacts', op: '<', value: 1 }] },
  { on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 14000 }, { field: 'contacts', op: '<', value: 2 }] },
  { on: true, logic: 'AND', conditions: [{ field: 'spendVnd', op: '>', value: 20000 }, { field: 'purchases', op: '<', value: 1 }] },
];

const DEFAULTS = { enabled: false, rate: 25000, intervalSec: 20, autoOff: true, revealPurchase: false, rules: DEFAULT_RULES };

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(null, (s) => {
    if (!s || Object.keys(s).length === 0) {
      chrome.storage.sync.set(DEFAULTS);
    }
  });
});
