// store.js
const { toStr } = require("../helper/toString");
const {
  getOneItem,
  getManyItems,
  updateOneItem,
  deleteOneItem,
  deleteManyItems,
  insertOneItem,
} = require("../database/store");

function makeStore({
  collectionName,
  idField = "itemId",
  validatePayload, // optional: fn(payload)
  getIdFromPayload, // optional: fn(payload) => id
} = {}) {
  if (!collectionName) throw new Error("collectionName is required");

  async function push(payload) {
    if (validatePayload) validatePayload(payload);

    const id = toStr(
      getIdFromPayload ? getIdFromPayload(payload) : payload?.id,
    );
    if (!id) throw new Error("payload id is required");

    const filter = { [idField]: id };
    const result = await insertOneItem(collectionName, filter, payload);

    return { ok: true, id, result };
  }

  async function get(id) {
    const filter = { [idField]: toStr(id) }; // Use dynamic ID based on collection
    const document = await getOneItem(collectionName, filter);
    return document ? document : null;
  }

  // Delete a document by its ID
  async function del(id) {
    const filter = { [idField]: toStr(id) }; // Use dynamic ID
    const result = await deleteOneItem(collectionName, filter);
    return { ok: true, id, deleted: result.deletedCount > 0 };
  }

  // Update a document by its ID
  async function update(id, meta = {}) {
    const filter = { [idField]: id }; // Use dynamic ID
    const result = await updateOneItem(collectionName, filter, meta);
    return { ok: true, id, result };
  }

  // Clear all documents from the collection
  async function clear() {
    const result = await deleteManyItems(collectionName, {});
    return { ok: true, cleared: result.deletedCount };
  }

  // Get all documents in the collection
  async function view(limit = 10) {
    const documents = await getManyItems(collectionName, {}, limit, true);
    return documents;
  }

  return { push, get, del, update, clear, view };
}

function isObj(x) {
  return x && typeof x === "object" && !Array.isArray(x);
}

function validateBatch(payload) {
  if (!isObj(payload)) throw new Error("payload must be an object");
  if (!toStr(payload.batchId)) throw new Error("payload.batchId is required");
  if (!toStr(payload.chatId)) throw new Error("payload.chatId is required");
  if (!isObj(payload.source)) throw new Error("payload.source is required");
  if (!toStr(payload.source.feedUrl))
    throw new Error("payload.source.feedUrl is required");
  if (!Array.isArray(payload.items))
    throw new Error("payload.items must be an array");
  if (payload.items.length === 0)
    throw new Error("payload.items must not be empty");
  if (!Array.isArray(payload.topics))
    throw new Error("payload.topics must be an array when provided");
  if (!Array.isArray(payload.flags))
    throw new Error("payload.flags must be an array when provided");
  if (!Array.isArray(payload.targets))
    throw new Error("payload.targets must be an array when provided");
}

function validateItem(payload) {
  if (!isObj(payload)) throw new Error("payload must be an object");
  if (!toStr(payload.itemId)) throw new Error("payload.itemId is required");
  if (!toStr(payload.batchId)) throw new Error("payload.batchId is required");
  if (!toStr(payload.title)) throw new Error("payload.title is required");
  if (!toStr(payload.link)) throw new Error("payload.link is required");
  if (!toStr(payload.guid)) throw new Error("payload.guid is required");
  if (!toStr(payload.snippet)) throw new Error("payload.snippet is required");
  if (!toStr(payload.status)) throw new Error("payload.status is required");
  if (!toStr(payload.type)) throw new Error("payload.type is required");
  if (!toStr(payload.publishedAt))
    throw new Error("payload.publishedAt is required");
  if (!Array.isArray(payload.topics))
    throw new Error("payload.topics must be an array when provided");
  if (!Array.isArray(payload.targets))
    throw new Error("payload.targets must be an array when provided");
}

const batchStore = makeStore({
  collectionName: "batches",
  idField: "batchId",
  validatePayload: validateBatch,
  getIdFromPayload: (p) => p.batchId,
});

const newsStore = makeStore({
  collectionName: "news",
  validatePayload: validateItem,
  getIdFromPayload: (p) => p.itemId,
});

const socialStore = makeStore({
  collectionName: "social",
  validatePayload: validateItem,
  getIdFromPayload: (p) => p.itemId,
});

const linkStore = makeStore({
  collectionName: "links",
  idField: "link",
  getIdFromPayload: (p) => p.link,
});

module.exports = { batchStore, newsStore, socialStore, linkStore };
