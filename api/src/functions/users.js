const { app } = require('@azure/functions');
const { checkAuthorization } = require('../middleware/auth');
const { readJSONWithETag, writeJSONWithETag, CONTAINER } = require('../storage/blob');

const USERS_PATH = '_config/allowed-users.json';

// All user management is admin-only.
// GET    /api/users          — list users
// POST   /api/users          — add user
// PUT    /api/users          — update user (body: { email, name, role, active, etag })
// DELETE /api/users?email=.. — remove user (query: email, etag)

app.http('users', {
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    authLevel: 'anonymous',
    route: 'users',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        if (authResult.user.role !== 'admin') {
            return { status: 403, jsonBody: { error: 'Admin access required' } };
        }

        const method = request.method;

        if (method === 'GET') return listUsers();
        if (method === 'POST') return addUser(request, context);
        if (method === 'PUT') return editUser(request, context);
        if (method === 'DELETE') return removeUser(request, context);

        return { status: 405, jsonBody: { error: 'Method not allowed' } };
    }
});

async function listUsers() {
    const { data, etag } = await readJSONWithETag(CONTAINER, USERS_PATH);
    if (!data) {
        return { status: 200, jsonBody: { users: [], etag: null } };
    }
    return { status: 200, jsonBody: { users: data.allowedUsers || [], etag } };
}

async function addUser(request, context) {
    const body = await request.json();
    const { email, name, role, etag } = body;

    if (!email) return { status: 400, jsonBody: { error: 'email is required' } };
    if (!etag) return { status: 400, jsonBody: { error: 'etag is required for concurrency control' } };
    if (!email.includes('@')) return { status: 400, jsonBody: { error: 'Invalid email format' } };

    const { data } = await readJSONWithETag(CONTAINER, USERS_PATH);
    if (!data) return { status: 404, jsonBody: { error: 'Users config not found' } };

    const normalizedEmail = email.toLowerCase();
    if (data.allowedUsers.find(u => u.email.toLowerCase() === normalizedEmail)) {
        return { status: 409, jsonBody: { error: 'User already exists' } };
    }

    data.allowedUsers.push({
        email: normalizedEmail,
        name: name || email,
        role: role || 'user',
        active: true
    });

    const result = await writeJSONWithETag(CONTAINER, USERS_PATH, data, etag);
    if (!result.success) {
        return { status: 409, jsonBody: { error: 'User list was modified by another admin — refresh and try again', conflict: true } };
    }

    context.log(`[users] Added: ${normalizedEmail}`);
    return { status: 201, jsonBody: { users: data.allowedUsers } };
}

async function editUser(request, context) {
    const body = await request.json();
    const { email, name, role, active, etag } = body;

    if (!email) return { status: 400, jsonBody: { error: 'email is required' } };
    if (!etag) return { status: 400, jsonBody: { error: 'etag is required for concurrency control' } };

    const { data } = await readJSONWithETag(CONTAINER, USERS_PATH);
    if (!data) return { status: 404, jsonBody: { error: 'Users config not found' } };

    const idx = data.allowedUsers.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return { status: 404, jsonBody: { error: 'User not found' } };

    // Prevent demoting/deactivating the last active admin
    const wasAdmin = data.allowedUsers[idx].role === 'admin';
    const becomingNonAdmin = role !== undefined && role !== 'admin';
    const becomingInactive = active === false;
    if (wasAdmin && (becomingNonAdmin || becomingInactive)) {
        const otherActiveAdmins = data.allowedUsers.filter(
            (u, i) => i !== idx && u.role === 'admin' && u.active !== false
        );
        if (otherActiveAdmins.length === 0) {
            return { status: 400, jsonBody: { error: 'Cannot demote or deactivate the last active admin' } };
        }
    }

    if (name !== undefined) data.allowedUsers[idx].name = name;
    if (role !== undefined) data.allowedUsers[idx].role = role;
    if (active !== undefined) data.allowedUsers[idx].active = active;

    const result = await writeJSONWithETag(CONTAINER, USERS_PATH, data, etag);
    if (!result.success) {
        return { status: 409, jsonBody: { error: 'User list was modified by another admin — refresh and try again', conflict: true } };
    }

    context.log(`[users] Edited: ${email}`);
    return { status: 200, jsonBody: { users: data.allowedUsers } };
}

async function removeUser(request, context) {
    const email = request.query.get('email');
    const etag = request.query.get('etag');

    if (!email) return { status: 400, jsonBody: { error: 'email query param is required' } };
    if (!etag) return { status: 400, jsonBody: { error: 'etag query param is required' } };

    const { data } = await readJSONWithETag(CONTAINER, USERS_PATH);
    if (!data) return { status: 404, jsonBody: { error: 'Users config not found' } };

    const normalizedEmail = email.toLowerCase();
    const before = data.allowedUsers.length;
    data.allowedUsers = data.allowedUsers.filter(u => u.email.toLowerCase() !== normalizedEmail);
    if (data.allowedUsers.length === before) return { status: 404, jsonBody: { error: 'User not found' } };

    if (data.allowedUsers.filter(u => u.role === 'admin').length === 0) {
        return { status: 400, jsonBody: { error: 'Cannot remove the last admin' } };
    }

    const result = await writeJSONWithETag(CONTAINER, USERS_PATH, data, etag);
    if (!result.success) {
        return { status: 409, jsonBody: { error: 'User list was modified by another admin — refresh and try again', conflict: true } };
    }

    context.log(`[users] Removed: ${normalizedEmail}`);
    return { status: 200, jsonBody: { users: data.allowedUsers } };
}
