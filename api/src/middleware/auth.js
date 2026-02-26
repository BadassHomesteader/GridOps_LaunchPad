const { readJSON, CONTAINER } = require('../storage/blob');

// Auto-admin emails always get admin access (bypass blob storage lookup)
const AUTO_ADMIN_EMAILS = [
    'jlunkwitz@contractcallers.com',
    'juergs@geeksare.cool',
    'juergs@geeksarecool.onmicrosoft.com'
];

function decodeJwt(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        let payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (payload.length % 4) payload += '=';
        const json = Buffer.from(payload, 'base64').toString('utf8');
        return JSON.parse(json);
    } catch (err) {
        return null;
    }
}

function getUserFromRequest(request) {
    // 1. X-Auth-Token (MSAL idToken — survives SWA reverse proxy)
    const customToken = request.headers.get('x-auth-token');
    if (customToken) {
        const claims = decodeJwt(customToken);
        if (claims) {
            const email = claims.preferred_username || claims.email || claims.upn;
            const name = claims.name || email;
            if (email) return { email: email.toLowerCase(), name, raw: claims };
        }
    }

    // 2. Authorization: Bearer header (local dev fallback)
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const claims = decodeJwt(authHeader.substring(7));
        if (claims) {
            const email = claims.preferred_username || claims.email || claims.upn;
            const name = claims.name || email;
            if (email) return { email: email.toLowerCase(), name, raw: claims };
        }
    }

    // 3. SWA Easy Auth header (x-ms-client-principal)
    const principalHeader = request.headers.get('x-ms-client-principal');
    if (principalHeader) {
        try {
            const principal = JSON.parse(Buffer.from(principalHeader, 'base64').toString('utf8'));
            let email = null;
            if (principal.claims && Array.isArray(principal.claims)) {
                const emailClaim = principal.claims.find(c =>
                    c.typ === 'preferred_username' ||
                    c.typ === 'email' ||
                    c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
                );
                if (emailClaim) email = emailClaim.val;
            }
            if (!email && principal.userDetails && principal.userDetails.includes('@')) {
                email = principal.userDetails;
            }
            const nameClaim = principal.claims?.find(c =>
                c.typ === 'name' ||
                c.typ === 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
            );
            const name = nameClaim?.val || principal.userDetails || email;
            if (email) return { email: email.toLowerCase(), name: name || email, raw: principal };
        } catch (e) { /* ignore */ }
    }

    // 4. x-ms-client-principal-name header
    const principalName = request.headers.get('x-ms-client-principal-name');
    if (principalName) {
        return { email: principalName.toLowerCase(), name: principalName };
    }

    return null;
}

async function checkAuthorization(request) {
    const user = getUserFromRequest(request);

    if (!user) {
        return {
            authorized: false,
            status: 401,
            error: 'Authentication required. Please sign in with your Microsoft account.'
        };
    }

    // Auto-admin bypass (no blob read needed)
    if (AUTO_ADMIN_EMAILS.some(e => e.toLowerCase() === user.email)) {
        return {
            authorized: true,
            user: { email: user.email, name: user.name, role: 'admin' }
        };
    }

    // Check allowed-users.json
    try {
        const config = await readJSON(CONTAINER, '_config/allowed-users.json');
        if (config && config.allowedUsers) {
            const allowedUser = config.allowedUsers.find(
                u => u.email.toLowerCase() === user.email
            );
            if (allowedUser) {
                if (allowedUser.active === false) {
                    return {
                        authorized: false,
                        status: 403,
                        error: 'Your account has been deactivated. Contact an administrator.'
                    };
                }
                return {
                    authorized: true,
                    user: { email: user.email, name: user.name || allowedUser.name, role: allowedUser.role || 'user' }
                };
            }
        }
    } catch (err) {
        console.error('[AUTH] Error reading allowed-users.json:', err.message);
    }

    return {
        authorized: false,
        status: 403,
        error: `Access denied. User ${user.email} is not in the allowed users list.`
    };
}

module.exports = { getUserFromRequest, checkAuthorization };
