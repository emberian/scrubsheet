// Each tab owns a draft. New tabs recover the most recently edited draft;
// existing tabs recover their own, so saving in one doesn't erase another.
export function createDraftStore() {
  let id;
  try {
    id = sessionStorage.getItem("scrubsheet-draft-id") || crypto.randomUUID();
    sessionStorage.setItem("scrubsheet-draft-id", id);
  } catch {
    id = crypto.randomUUID();
  }
  const database = new Promise((resolve, reject) => {
    const request = indexedDB.open("scrubsheet", 2);
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains("drafts")
        ? request.transaction.objectStore("drafts")
        : request.result.createObjectStore("drafts", { keyPath: "id" });
      if (!store.indexNames.contains("updated"))
        store.createIndex("updated", "updated");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Browser storage is busy."));
  });
  database.catch(() => {});
  return {
    async read() {
      const db = await database;
      return new Promise((resolve, reject) => {
        const store = db.transaction("drafts").objectStore("drafts");
        const request = store.get(id);
        request.onsuccess = () => {
          if (request.result) {
            resolve(request.result.project);
            return;
          }
          const latest = store.index("updated").openCursor(null, "prev");
          latest.onsuccess = () =>
            resolve(latest.result?.value.project || null);
          latest.onerror = () => reject(latest.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    async write(project) {
      const db = await database;
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("drafts", "readwrite");
        transaction
          .objectStore("drafts")
          .put({ id, updated: Date.now(), project });
        transaction.oncomplete = resolve;
        transaction.onabort = transaction.onerror = () =>
          reject(
            transaction.error || new Error("Browser storage is unavailable."),
          );
      });
    },
  };
}
