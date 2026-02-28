const { app } = require('@azure/functions');
const { checkAuthorization } = require('../middleware/auth');
const { readJSON, writeJSON, CONTAINER } = require('../storage/blob');

const ANNOUNCEMENT_PATH = '_config/announcement.json';

// GET /api/announcement — get active announcement (any authenticated user)
app.http('getAnnouncement', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'announcement',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        try {
            const announcement = await readJSON(CONTAINER, ANNOUNCEMENT_PATH);
            return { status: 200, jsonBody: { announcement: announcement || null } };
        } catch (err) {
            context.error('[getAnnouncement]', err);
            return { status: 500, jsonBody: { error: 'Failed to load announcement' } };
        }
    }
});

// PUT /api/announcement — post/update announcement (admin only)
app.http('putAnnouncement', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'announcement',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        if (authResult.user.role !== 'admin') {
            return { status: 403, jsonBody: { error: 'Admin access required' } };
        }
        try {
            const body = await request.json();
            if (!body.message || !body.message.trim()) {
                return { status: 400, jsonBody: { error: 'message is required' } };
            }
            const announcement = {
                id: `ann-${Date.now()}`,
                title: (body.title || '').trim(),
                message: body.message.trim(),
                createdAt: new Date().toISOString(),
                createdBy: authResult.user.email
            };
            await writeJSON(CONTAINER, ANNOUNCEMENT_PATH, announcement);
            return { status: 200, jsonBody: announcement };
        } catch (err) {
            context.error('[putAnnouncement]', err);
            return { status: 500, jsonBody: { error: 'Failed to save announcement' } };
        }
    }
});

// DELETE /api/announcement — clear announcement (admin only)
app.http('deleteAnnouncement', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    route: 'announcement',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        if (authResult.user.role !== 'admin') {
            return { status: 403, jsonBody: { error: 'Admin access required' } };
        }
        try {
            await writeJSON(CONTAINER, ANNOUNCEMENT_PATH, null);
            return { status: 200, jsonBody: { success: true } };
        } catch (err) {
            context.error('[deleteAnnouncement]', err);
            return { status: 500, jsonBody: { error: 'Failed to clear announcement' } };
        }
    }
});
