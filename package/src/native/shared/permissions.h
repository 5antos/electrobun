// permissions.h - Cross-platform permission cache management
// Used for caching user media, geolocation, and notification permissions
// across Windows, macOS, and Linux
//
// This is a header-only implementation to avoid build complexity.

#ifndef ELECTROBUN_PERMISSIONS_H
#define ELECTROBUN_PERMISSIONS_H

#include <string>
#include <map>
#include <vector>
#include <fstream>
#include <sstream>
#include <chrono>
#include <mutex>
#include <utility>

namespace electrobun {

enum class PermissionType {
    USER_MEDIA,
    GEOLOCATION,
    NOTIFICATIONS,
    OTHER
};

enum class PermissionStatus {
    UNKNOWN,
    ALLOWED,
    DENIED
};

struct PermissionCacheEntry {
    PermissionStatus status;
    std::chrono::system_clock::time_point expiry;
};

// Thread-safe permission cache with optional disk persistence.
// Call setStoragePath() once at startup (before any get/set calls) to enable
// persistence across app launches. Without a storage path the cache is
// in-memory only and resets on every restart.
class PermissionCache {
public:
    static PermissionCache& getInstance() {
        static PermissionCache instance;
        return instance;
    }

    // Extract origin from a URL (e.g., "https://example.com/path" -> "https://example.com")
    static std::string getOriginFromUrl(const std::string& url) {
        // For views:// scheme, use a constant origin since these are local files
        if (url.find("views://") == 0) {
            return "views://";
        }

        // For other schemes, extract origin from URL
        size_t protocolEnd = url.find("://");
        if (protocolEnd == std::string::npos) return url;

        size_t domainStart = protocolEnd + 3;
        size_t pathStart = url.find('/', domainStart);

        if (pathStart == std::string::npos) {
            return url;
        }

        return url.substr(0, pathStart);
    }

    // Set the path to the persistence file (e.g. ".../WebView2/permissions.dat").
    // Must be called before the first get()/set() call for persistence to take effect.
    void setStoragePath(const std::string& path) {
        std::lock_guard<std::mutex> lock(mutex_);
        storagePath_ = path;
        loaded_ = false; // Trigger a fresh load from the new path
    }

    PermissionStatus get(const std::string& origin, PermissionType type) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!loaded_) {
            loadFromDiskLocked();
        }
        auto key = std::make_pair(origin, type);
        auto it = cache_.find(key);

        if (it != cache_.end()) {
            // Check if permission hasn't expired
            auto now = std::chrono::system_clock::now();
            if (now < it->second.expiry) {
                return it->second.status;
            } else {
                // Permission expired, remove from cache
                cache_.erase(it);
                saveToDiskLocked();
            }
        }

        return PermissionStatus::UNKNOWN;
    }

    void set(const std::string& origin, PermissionType type, PermissionStatus status) {
        std::lock_guard<std::mutex> lock(mutex_);
        if (!loaded_) {
            loadFromDiskLocked();
        }
        auto key = std::make_pair(origin, type);

        // Permissions granted by the user for a desktop app should persist for
        // a long time — 365 days — so the user isn't re-prompted every session.
        auto expiry = std::chrono::system_clock::now() + std::chrono::hours(24 * 365);

        cache_[key] = {status, expiry};

        saveToDiskLocked();
    }

private:
    PermissionCache() = default;
    PermissionCache(const PermissionCache&) = delete;
    PermissionCache& operator=(const PermissionCache&) = delete;

    // Must be called with mutex_ already held.
    void loadFromDiskLocked() {
        loaded_ = true;
        if (storagePath_.empty()) return;

        std::ifstream file(storagePath_);
        if (!file.is_open()) return;

        auto now = std::chrono::system_clock::now();
        std::string line;
        while (std::getline(file, line)) {
            if (line.empty() || line[0] == '#') continue;

            // Format: origin|type|status|expiry_seconds
            std::vector<std::string> parts;
            std::stringstream ss(line);
            std::string part;
            while (std::getline(ss, part, '|')) {
                parts.push_back(part);
            }
            if (parts.size() != 4) continue;

            try {
                std::string origin = parts[0];
                int typeInt = std::stoi(parts[1]);
                int statusInt = std::stoi(parts[2]);
                long long expirySeconds = std::stoll(parts[3]);

                auto expiryTime = std::chrono::system_clock::time_point(
                    std::chrono::seconds(expirySeconds));

                if (now >= expiryTime) continue; // Skip expired entries

                auto key = std::make_pair(origin, static_cast<PermissionType>(typeInt));
                cache_[key] = {static_cast<PermissionStatus>(statusInt), expiryTime};
            } catch (...) {
                // Skip malformed lines
            }
        }
    }

    // Must be called with mutex_ already held.
    void saveToDiskLocked() {
        if (storagePath_.empty()) return;

        std::ofstream file(storagePath_);
        if (!file.is_open()) return;

        auto now = std::chrono::system_clock::now();
        for (const auto& entry : cache_) {
            if (now >= entry.second.expiry) continue; // Skip expired

            long long expirySeconds = std::chrono::duration_cast<std::chrono::seconds>(
                entry.second.expiry.time_since_epoch()).count();

            file << entry.first.first << "|"
                 << static_cast<int>(entry.first.second) << "|"
                 << static_cast<int>(entry.second.status) << "|"
                 << expirySeconds << "\n";
        }
    }

    std::map<std::pair<std::string, PermissionType>, PermissionCacheEntry> cache_;
    std::mutex mutex_;
    std::string storagePath_;
    bool loaded_ = false;
};

// Convenience functions that use the singleton (for easier migration from existing code)
inline std::string getOriginFromUrl(const std::string& url) {
    return PermissionCache::getOriginFromUrl(url);
}

inline PermissionStatus getPermissionFromCache(const std::string& origin, PermissionType type) {
    return PermissionCache::getInstance().get(origin, type);
}

inline void cachePermission(const std::string& origin, PermissionType type, PermissionStatus status) {
    PermissionCache::getInstance().set(origin, type, status);
}

} // namespace electrobun

#endif // ELECTROBUN_PERMISSIONS_H
