const { app } = require('@azure/functions');
const { checkAuthorization } = require('../middleware/auth');
const { readJSONWithETag, writeJSONWithETag, writeJSON, CONTAINER } = require('../storage/blob');
const crypto = require('crypto');

const FEEDBACK_PATH = '_feedback/items.json';
const MAX_RETRIES = 3;

function generateId() {
    return `fb-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// GET /api/feedback — list all feedback (admin only)
app.http('listFeedback', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'feedback',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        if (authResult.user.role !== 'admin') {
            return { status: 403, jsonBody: { error: 'Admin access required' } };
        }

        const { data } = await readJSONWithETag(CONTAINER, FEEDBACK_PATH);
        const items = (data?.items || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return { status: 200, jsonBody: { items } };
    }
});

// POST /api/feedback — submit feedback (any authenticated user)
app.http('createFeedback', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'feedback',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }

        const body = await request.json();
        if (!body.message) {
            return { status: 400, jsonBody: { error: 'message is required' } };
        }

        const item = {
            id: generateId(),
            message: body.message,
            type: body.type || 'general',
            status: 'open',
            reportedBy: authResult.user.name || authResult.user.email,
            reportedByEmail: authResult.user.email,
            createdAt: new Date().toISOString()
        };

        // ETag-protected append to items array
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const { data, etag } = await readJSONWithETag(CONTAINER, FEEDBACK_PATH);
            const items = data?.items || [];
            items.push(item);
            const payload = { items, count: items.length, lastUpdated: new Date().toISOString() };

            if (etag) {
                const result = await writeJSONWithETag(CONTAINER, FEEDBACK_PATH, payload, etag);
                if (result.success) break;
            } else {
                await writeJSON(CONTAINER, FEEDBACK_PATH, payload);
                break;
            }

            if (attempt === MAX_RETRIES - 1) {
                context.warn('[createFeedback] Failed to save after retries');
            }
        }

        return { status: 201, jsonBody: item };
    }
});

// PUT /api/feedback/{id} — update feedback status (admin only)
app.http('updateFeedback', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'feedback/{id}',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        if (authResult.user.role !== 'admin') {
            return { status: 403, jsonBody: { error: 'Admin access required' } };
        }

        const id = request.params.id;
        const body = await request.json();

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const { data, etag } = await readJSONWithETag(CONTAINER, FEEDBACK_PATH);
            if (!data) return { status: 404, jsonBody: { error: 'Feedback not found' } };

            const idx = data.items.findIndex(i => i.id === id);
            if (idx === -1) return { status: 404, jsonBody: { error: 'Feedback item not found' } };

            if (body.status !== undefined) data.items[idx].status = body.status;
            if (body.note !== undefined) data.items[idx].note = body.note;
            data.items[idx].updatedAt = new Date().toISOString();

            const payload = { items: data.items, count: data.items.length, lastUpdated: new Date().toISOString() };
            const result = await writeJSONWithETag(CONTAINER, FEEDBACK_PATH, payload, etag);
            if (result.success) {
                return { status: 200, jsonBody: data.items[idx] };
            }
        }

        return { status: 409, jsonBody: { error: 'Conflict — please retry' } };
    }
});

// DELETE /api/feedback/{id} — delete feedback (admin only)
app.http('deleteFeedback', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'feedback/{id}',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        if (authResult.user.role !== 'admin') {
            return { status: 403, jsonBody: { error: 'Admin access required' } };
        }

        const id = request.params.id;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            const { data, etag } = await readJSONWithETag(CONTAINER, FEEDBACK_PATH);
            if (!data) return { status: 404, jsonBody: { error: 'Feedback not found' } };

            const before = data.items.length;
            data.items = data.items.filter(i => i.id !== id);
            if (data.items.length === before) return { status: 404, jsonBody: { error: 'Feedback item not found' } };

            const payload = { items: data.items, count: data.items.length, lastUpdated: new Date().toISOString() };
            const result = await writeJSONWithETag(CONTAINER, FEEDBACK_PATH, payload, etag);
            if (result.success) return { status: 200, jsonBody: { deleted: true } };
        }

        return { status: 409, jsonBody: { error: 'Conflict — please retry' } };
    }
});
