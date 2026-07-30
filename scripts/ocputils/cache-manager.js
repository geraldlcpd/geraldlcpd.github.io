/**
 * ImageCacheManager - Client-side IndexedDB Cache for Clipboard Images
 */
class ImageCacheManager {
    static dbPromise = null;

    static getDB() {
        if (!ImageCacheManager.dbPromise) {
            ImageCacheManager.dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open('OCP_ImageCache_DB', 1);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains('images')) {
                        db.createObjectStore('images', { keyPath: 'id' });
                    }
                };
                request.onsuccess = (e) => resolve(e.target.result);
                request.onerror = (e) => reject(e.target.error);
            });
        }
        return ImageCacheManager.dbPromise;
    }

    static async getImage(id) {
        try {
            const db = await ImageCacheManager.getDB();
            return new Promise((resolve) => {
                const tx = db.transaction('images', 'readonly');
                const store = tx.objectStore('images');
                const req = store.get(id);
                req.onsuccess = () => resolve(req.result ? req.result.data : null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    }

    static async setImage(id, imageDataObj) {
        try {
            const db = await ImageCacheManager.getDB();
            return new Promise((resolve) => {
                const tx = db.transaction('images', 'readwrite');
                const store = tx.objectStore('images');
                store.put({ id: id, data: imageDataObj, timestamp: Date.now() });
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch (e) {
            return false;
        }
    }

    static async deleteImage(id) {
        try {
            const db = await ImageCacheManager.getDB();
            return new Promise((resolve) => {
                const tx = db.transaction('images', 'readwrite');
                const store = tx.objectStore('images');
                store.delete(id);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch (e) {
            return false;
        }
    }
}
