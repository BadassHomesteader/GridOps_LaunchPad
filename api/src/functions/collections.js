const { app } = require('@azure/functions');
const { checkAuthorization } = require('../middleware/auth');
const { readJSON, writeJSON, listJSON, deleteBlob, CONTAINER } = require('../storage/blob');
const crypto = require('crypto');

const PREFIX = 'collections/';

function generateId() {
    return `col-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function generateLinkId() {
    return `lnk-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

// Returns true if the user can see this collection
function canRead(collection, userEmail, isAdmin) {
    if (isAdmin) return true;
    if ((collection.owner || '').toLowerCase() === userEmail) return true;
    if (Array.isArray(collection.sharedWith)) {
        return collection.sharedWith.some(e =>
            (typeof e === 'string' ? e : e.email).toLowerCase() === userEmail
        );
    }
    return false;
}

// Returns true if the user can modify this collection's metadata/links
function canWrite(collection, userEmail, isAdmin) {
    if (isAdmin) return true;
    return (collection.owner || '').toLowerCase() === userEmail;
}

// GET /api/collections — list all collections visible to the current user
app.http('listCollections', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'collections',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }

        const userEmail = authResult.user.email;
        const isAdmin = authResult.user.role === 'admin';

        try {
            const blobNames = await listJSON(CONTAINER, PREFIX);
            const collections = [];

            for (const blobName of blobNames) {
                const data = await readJSON(CONTAINER, blobName);
                if (data && canRead(data, userEmail, isAdmin)) {
                    collections.push(data);
                }
            }

            collections.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            return { status: 200, jsonBody: { collections } };
        } catch (err) {
            context.error('[listCollections]', err);
            return { status: 500, jsonBody: { error: 'Failed to list collections' } };
        }
    }
});

// POST /api/collections — create a collection (admin only)
app.http('createCollection', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'collections',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        if (authResult.user.role !== 'admin') {
            return { status: 403, jsonBody: { error: 'Admin access required' } };
        }

        const body = await request.json();
        if (!body.name) {
            return { status: 400, jsonBody: { error: 'name is required' } };
        }

        const id = generateId();
        const now = new Date().toISOString();
        const collection = {
            id,
            name: body.name,
            icon: body.icon || '🔗',
            description: body.description || '',
            owner: authResult.user.email,
            createdAt: now,
            updatedAt: now,
            sharedWith: body.sharedWith || [],
            links: []
        };

        await writeJSON(CONTAINER, `${PREFIX}${id}.json`, collection);
        context.log(`[createCollection] Created: ${id} — "${body.name}"`);
        return { status: 201, jsonBody: collection };
    }
});

// GET /api/collections/{id} — get one collection
app.http('getCollection', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'collections/{id}',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }

        const id = request.params.id;
        const data = await readJSON(CONTAINER, `${PREFIX}${id}.json`);
        if (!data) return { status: 404, jsonBody: { error: 'Collection not found' } };

        const userEmail = authResult.user.email;
        const isAdmin = authResult.user.role === 'admin';
        if (!canRead(data, userEmail, isAdmin)) {
            return { status: 403, jsonBody: { error: 'Access denied' } };
        }

        return { status: 200, jsonBody: data };
    }
});

// PUT /api/collections/{id} — update collection metadata and/or links
app.http('updateCollection', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'collections/{id}',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }

        const id = request.params.id;
        const existing = await readJSON(CONTAINER, `${PREFIX}${id}.json`);
        if (!existing) return { status: 404, jsonBody: { error: 'Collection not found' } };

        const userEmail = authResult.user.email;
        const isAdmin = authResult.user.role === 'admin';
        if (!canWrite(existing, userEmail, isAdmin)) {
            return { status: 403, jsonBody: { error: 'Only the owner or admin can update this collection' } };
        }

        const body = await request.json();

        // Ensure any new links without IDs get one assigned
        let links = body.links !== undefined ? body.links : existing.links;
        links = links.map(link => ({ ...link, id: link.id || generateLinkId() }));

        const updated = {
            ...existing,
            name: body.name !== undefined ? body.name : existing.name,
            icon: body.icon !== undefined ? body.icon : existing.icon,
            description: body.description !== undefined ? body.description : existing.description,
            links,
            updatedAt: new Date().toISOString()
        };

        // Only admin can change sharing
        if (isAdmin && body.sharedWith !== undefined) {
            updated.sharedWith = body.sharedWith;
        }

        await writeJSON(CONTAINER, `${PREFIX}${id}.json`, updated);
        return { status: 200, jsonBody: updated };
    }
});

// DELETE /api/collections/{id} — delete collection (admin only)
app.http('deleteCollection', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'collections/{id}',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        if (authResult.user.role !== 'admin') {
            return { status: 403, jsonBody: { error: 'Admin access required' } };
        }

        const id = request.params.id;
        const deleted = await deleteBlob(CONTAINER, `${PREFIX}${id}.json`);
        if (!deleted) return { status: 404, jsonBody: { error: 'Collection not found' } };

        context.log(`[deleteCollection] Deleted: ${id}`);
        return { status: 200, jsonBody: { deleted: true } };
    }
});

// PUT /api/collections/{id}/sharing — update sharing list (admin only)
app.http('updateCollectionSharing', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'collections/{id}/sharing',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        if (authResult.user.role !== 'admin') {
            return { status: 403, jsonBody: { error: 'Admin access required' } };
        }

        const id = request.params.id;
        const existing = await readJSON(CONTAINER, `${PREFIX}${id}.json`);
        if (!existing) return { status: 404, jsonBody: { error: 'Collection not found' } };

        const body = await request.json();
        const updated = {
            ...existing,
            sharedWith: body.sharedWith || [],
            updatedAt: new Date().toISOString()
        };

        await writeJSON(CONTAINER, `${PREFIX}${id}.json`, updated);
        return { status: 200, jsonBody: updated };
    }
});
