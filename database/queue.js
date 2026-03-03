const { getCollection } = require("./mongodb"); // MongoDB client

async function insertQueueItem(collectionName, payload) {
  const col = await getCollection(collectionName);

  return col.insertOne({
    ...payload,
    createdAt: new Date(),
  });
}

async function popOldestQueueItem(collectionName, filter = {}) {
  const col = await getCollection(collectionName);

  return col.findOneAndDelete(filter, { sort: { createdAt: 1 } });
}

async function getQueueItems(collectionName, limit = 10) {
  const col = await getCollection(collectionName);

  return col.find({}).sort({ createdAt: 1 }).limit(limit).toArray();
}

async function deleteQueueItem(collectionName, id) {
  const col = await getCollection(collectionName);

  return col.deleteOne({ _id: id });
}

async function clearQueue(collectionName) {
  const col = await getCollection(collectionName);

  return col.deleteMany({});
}

async function countQueueItems(collectionName) {
  const col = await getCollection(collectionName);

  return col.estimatedDocumentCount();
}

module.exports = {
  insertQueueItem,
  popOldestQueueItem,
  getQueueItems,
  deleteQueueItem,
  clearQueue,
  countQueueItems,
};
