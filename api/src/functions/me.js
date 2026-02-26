const { app } = require('@azure/functions');
const { checkAuthorization } = require('../middleware/auth');

app.http('me', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'me',
    handler: async (request, context) => {
        const authResult = await checkAuthorization(request);
        if (!authResult.authorized) {
            return { status: authResult.status, jsonBody: { error: authResult.error } };
        }
        return {
            status: 200,
            jsonBody: {
                email: authResult.user.email,
                name: authResult.user.name,
                role: authResult.user.role,
                authenticated: true
            }
        };
    }
});
