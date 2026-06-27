const DB_NAME = 'pwallm_db';
const DB_VERSION = 1;

let dbInstance = null;

export function initDb() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      console.log('IndexedDB initialized successfully');
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Conversations store
      if (!db.objectStoreNames.contains('conversations')) {
        const convoStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convoStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      
      // Messages store
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('conversationId', 'conversationId', { unique: false });
        msgStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// Helpers for opening transaction
function getStore(storeName, mode) {
  return initDb().then((db) => {
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  });
}

// Conversations Operations
export function saveConversation(conversation) {
  return getStore('conversations', 'readwrite').then((store) => {
    return new Promise((resolve, reject) => {
      const data = {
        ...conversation,
        updatedAt: conversation.updatedAt || Date.now(),
        createdAt: conversation.createdAt || Date.now()
      };
      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export function getConversations() {
  return getStore('conversations', 'readonly').then((store) => {
    return new Promise((resolve, reject) => {
      const index = store.index('updatedAt');
      const request = index.openCursor(null, 'prev'); // Most recent first
      const results = [];
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export function getConversation(id) {
  return getStore('conversations', 'readonly').then((store) => {
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export function deleteConversation(id) {
  return getStore('conversations', 'readwrite').then((convoStore) => {
    return new Promise((resolve, reject) => {
      const request = convoStore.delete(id);
      request.onsuccess = () => {
        // Also delete associated messages
        getStore('messages', 'readwrite').then((msgStore) => {
          const index = msgStore.index('conversationId');
          const range = IDBKeyRange.only(id);
          const cursorRequest = index.openCursor(range);
          
          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              msgStore.delete(cursor.primaryKey);
              cursor.continue();
            } else {
              resolve();
            }
          };
        }).catch(reject);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

// Messages Operations
export function saveMessage(message) {
  return getStore('messages', 'readwrite').then((store) => {
    return new Promise((resolve, reject) => {
      const data = {
        ...message,
        timestamp: message.timestamp || Date.now()
      };
      const request = store.put(data);
      request.onsuccess = () => resolve(data);
      request.onerror = (e) => reject(e.target.error);
    });
  });
}

export function getMessages(conversationId) {
  return getStore('messages', 'readonly').then((store) => {
    return new Promise((resolve, reject) => {
      const index = store.index('conversationId');
      const range = IDBKeyRange.only(conversationId);
      const request = index.openCursor(range);
      const results = [];
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          // Sort by timestamp just in case
          results.sort((a, b) => a.timestamp - b.timestamp);
          resolve(results);
        }
      };
      request.onerror = (e) => reject(e.target.error);
    });
  });
}
