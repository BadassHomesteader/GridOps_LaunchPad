const { app } = require('@azure/functions');
const { checkAuthorization } = require('../middleware/auth');
const { readJSON, writeJSON, CONTAINER } = require('../storage/blob');

// Blob path for a user's personal links (sanitize email for safe path segment)
function personalPath(email) {
    const safe = email.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
    return `personal/${safe}/my-links.json`;
}

// GET /api/personal — get the current user's personal links
app.http('getPersonalLinks', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'personal',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }

        const data = await readJSON(CONTAINER, personalPath(authResult.user.email));
        return { status: 200, jsonBody: data || { links: [] } };
    }
});

// PUT /api/personal — save the current user's personal links
app.http('savePersonalLinks', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'personal',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }

        const body = await request.json();
        if (!Array.isArray(body.links)) {
            return { status: 400, jsonBody: { error: 'links array is required' } };
        }

        const data = { links: body.links, updatedAt: new Date().toISOString() };
        await writeJSON(CONTAINER, personalPath(authResult.user.email), data);
        return { status: 200, jsonBody: data };
    }
});
