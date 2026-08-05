package tinode

import (
	"sync"
	"time"
)

// tokenCacheTTL bounds how long a resolved token→uid mapping is trusted before a
// fresh gRPC validation is forced. A revoked token therefore stops working
// within this window at worst. Kept short (5m) to balance the saved gRPC
// round-trips against revocation latency.
const tokenCacheTTL = 5 * time.Minute

// tokenCacheMax caps the number of cached entries so a flood of distinct tokens
// cannot grow the map without bound. When full, expired entries are swept and,
// if still full, one arbitrary entry is dropped to make room.
const tokenCacheMax = 4096

type tokenCacheEntry struct {
	uid     string
	expires time.Time
}

// tokenCache is a tiny TTL map (token→uid) that guards the expensive
// ResolveToken gRPC round-trip. It is thread-safe via its own mutex and is
// independent of the Client's stream mutexes, so a cache hit never contends with
// live ROOT traffic.
type tokenCache struct {
	mu      sync.Mutex
	entries map[string]tokenCacheEntry
	ttl     time.Duration
	max     int
}

func newTokenCache(ttl time.Duration, max int) *tokenCache {
	return &tokenCache{
		entries: make(map[string]tokenCacheEntry),
		ttl:     ttl,
		max:     max,
	}
}

// get returns the cached uid for token if present and unexpired. A stale entry
// is evicted on read and reported as a miss.
func (tc *tokenCache) get(token string) (string, bool) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	e, ok := tc.entries[token]
	if !ok {
		return "", false
	}
	if time.Now().After(e.expires) {
		delete(tc.entries, token)
		return "", false
	}
	return e.uid, true
}

// put records token→uid with a fresh TTL. If the cache is at capacity it first
// sweeps expired entries and, failing that, drops one arbitrary entry so the
// insert can proceed.
func (tc *tokenCache) put(token, uid string) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	if len(tc.entries) >= tc.max {
		tc.evictLocked()
	}
	tc.entries[token] = tokenCacheEntry{uid: uid, expires: time.Now().Add(tc.ttl)}
}

// invalidate drops any cached mapping for token, forcing the next resolve to
// re-validate against Tinode. Intended for a logout / token-revocation path;
// TTL expiry covers the common case.
func (tc *tokenCache) invalidate(token string) {
	tc.mu.Lock()
	delete(tc.entries, token)
	tc.mu.Unlock()
}

// evictLocked removes expired entries; if the map is still at capacity it drops a
// single arbitrary entry so a put can proceed. Caller must hold tc.mu.
func (tc *tokenCache) evictLocked() {
	now := time.Now()
	for k, e := range tc.entries {
		if now.After(e.expires) {
			delete(tc.entries, k)
		}
	}
	if len(tc.entries) < tc.max {
		return
	}
	for k := range tc.entries {
		delete(tc.entries, k)
		return
	}
}
