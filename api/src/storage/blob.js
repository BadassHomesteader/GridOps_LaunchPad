const { BlobServiceClient } = require('@azure/storage-blob');
const fs = require('fs');
const path = require('path');

const CONTAINER = 'gridops-launchpad-data';

let _blobServiceClient = null;

function getBlobServiceClient() {
    if (!_blobServiceClient) {
        const cs = process.env.STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage;
        if (!cs) throw new Error('Missing STORAGE_CONNECTION_STRING or AzureWebJobsStorage env var');
        _blobServiceClient = BlobServiceClient.fromConnectionString(cs);
    }
    return _blobServiceClient;
}

// Local dev data lives at GridOps_LaunchPad/gridops-launchpad-data/
// api/src/storage → up 3 levels → GridOps_LaunchPad/
const LOCAL_DATA_PATH = path.resolve(__dirname, '../../..');

async function streamToString(readableStream) {
    readableStream.setEncoding('utf8');
    let data = '';
    for await (const chunk of readableStream) data += chunk;
    return data;
}

const connStr = process.env.STORAGE_CONNECTION_STRING || process.env.AzureWebJobsStorage || '';
const USE_LOCAL_STORAGE = connStr === 'UseDevelopmentStorage=true';

async function readJSON(containerName, blobName) {
    if (USE_LOCAL_STORAGE) {
        const localPath = path.join(LOCAL_DATA_PATH, containerName, blobName);
        try {
            return JSON.parse(fs.readFileSync(localPath, 'utf8'));
        } catch (e) {
            if (e.code === 'ENOENT') return null;
            throw e;
        }
    }
    const containerClient = getBlobServiceClient().getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);
    try {
        const res = await blobClient.download(0);
        return JSON.parse(await streamToString(res.readableStreamBody));
    } catch (e) {
        if (e.statusCode === 404) return null;
        throw e;
    }
}

async function readJSONWithETag(containerName, blobName) {
    if (USE_LOCAL_STORAGE) {
        const localPath = path.join(LOCAL_DATA_PATH, containerName, blobName);
        try {
            const content = fs.readFileSync(localPath, 'utf8');
            const stats = fs.statSync(localPath);
            return { data: JSON.parse(content), etag: `"${stats.mtimeMs}"` };
        } catch (e) {
            if (e.code === 'ENOENT') return { data: null, etag: null };
            throw e;
        }
    }
    const containerClient = getBlobServiceClient().getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);
    try {
        const res = await blobClient.download(0);
        return { data: JSON.parse(await streamToString(res.readableStreamBody)), etag: res.etag };
    } catch (e) {
        if (e.statusCode === 404) return { data: null, etag: null };
        throw e;
    }
}

async function writeJSON(containerName, blobName, data) {
    const content = JSON.stringify(data, null, 2);
    if (USE_LOCAL_STORAGE) {
        const localPath = path.join(LOCAL_DATA_PATH, containerName, blobName);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, content, 'utf8');
        return;
    }
    const containerClient = getBlobServiceClient().getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);
    await blobClient.upload(content, Buffer.byteLength(content), {
        overwrite: true,
        blobHTTPHeaders: { blobContentType: 'application/json' }
    });
}

async function writeJSONWithETag(containerName, blobName, data, etag) {
    const content = JSON.stringify(data, null, 2);
    if (USE_LOCAL_STORAGE) {
        const localPath = path.join(LOCAL_DATA_PATH, containerName, blobName);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        if (etag) {
            try {
                const stats = fs.statSync(localPath);
                if (`"${stats.mtimeMs}"` !== etag) return { success: false, error: 'CONFLICT' };
            } catch (e) {
                if (e.code === 'ENOENT') return { success: false, error: 'CONFLICT' };
                throw e;
            }
        }
        fs.writeFileSync(localPath, content, 'utf8');
        return { success: true };
    }
    const containerClient = getBlobServiceClient().getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);
    try {
        const options = { blobHTTPHeaders: { blobContentType: 'application/json' } };
        if (etag) options.conditions = { ifMatch: etag };
        await blobClient.upload(content, Buffer.byteLength(content), options);
        return { success: true };
    } catch (e) {
        if (e.statusCode === 412) return { success: false, error: 'CONFLICT' };
        throw e;
    }
}

async function listJSON(containerName, prefix) {
    if (USE_LOCAL_STORAGE) {
        const localDir = path.join(LOCAL_DATA_PATH, containerName, prefix);
        try {
            return fs.readdirSync(localDir)
                .filter(f => f.endsWith('.json'))
                .map(f => `${prefix}${f}`);
        } catch (e) {
            if (e.code === 'ENOENT') return [];
            throw e;
        }
    }
    const containerClient = getBlobServiceClient().getContainerClient(containerName);
    const blobs = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        if (blob.name.endsWith('.json')) blobs.push(blob.name);
    }
    return blobs;
}

async function deleteBlob(containerName, blobName) {
    if (USE_LOCAL_STORAGE) {
        const localPath = path.join(LOCAL_DATA_PATH, containerName, blobName);
        try {
            fs.unlinkSync(localPath);
            return true;
        } catch (e) {
            if (e.code === 'ENOENT') return false;
            throw e;
        }
    }
    const containerClient = getBlobServiceClient().getContainerClient(containerName);
    const blobClient = containerClient.getBlockBlobClient(blobName);
    try {
        await blobClient.delete();
        return true;
    } catch (e) {
        if (e.statusCode === 404) return false;
        throw e;
    }
}

module.exports = { readJSON, readJSONWithETag, writeJSON, writeJSONWithETag, listJSON, deleteBlob, CONTAINER };
