# User-Contributed Links — Implementation Plan

## What
Allow collection members to add their own links to any collection they belong to.
Links are visible to all members. Contributors can delete only their own links.
Admins and collection owners retain full control.

## Scope
- Members can **add** a link to any collection they're a member of
- Members can **delete** links they personally added (`contributedBy` field)
- No edit for contributed links (admin.html handles that)
- No icon picker in user-facing add modal (keep it simple)

---

## Backend — `api/src/functions/collections.js`

### 1. Add `canContribute()` helper (after `canWrite`, line 32)
Same logic as `canRead` — owner, admin, or any shared-with member.

### 2. New: `POST /api/collections/{id}/links`
- Requires `canContribute`
- Body: `{ name, url, description?, icon? }`
- Appends link with `id`, `contributedBy: userEmail`, `contributedAt: now`
- Returns updated collection

### 3. New: `DELETE /api/collections/{id}/links/{linkId}`
- Admin/owner: can delete any link
- Member: can only delete if `link.contributedBy === userEmail`
- Returns updated collection (404 if not found, 403 if unauthorized)

---

## Frontend — `index.html`

### New module-level variable
```js
let targetCollectionId = null;  // null = personal, string = collection id
```

### New `apiDelete()` helper
```js
async function apiDelete(path) {
  const res = await fetch(`/api${path}`, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}
```

### New `userCanContribute(collection)` helper
```js
function userCanContribute(collection) {
    if (!currentUser) return false;
    const email = currentUser.email.toLowerCase();
    if (currentUser.role === 'admin') return true;
    if ((collection.owner || '').toLowerCase() === email) return true;
    return Array.isArray(collection.sharedWith) && collection.sharedWith.some(e =>
        (typeof e === 'string' ? e : e.email).toLowerCase() === email
    );
}
```

### Changes to existing functions

**`renderSection(section)`** (line 781) — show `+ Add` for contributable collections:
```js
const canContrib = personal || userCanContribute(section);
const addBtn = canContrib
    ? `<button class="section-add-btn" onclick="openAddLinkModal(${personal ? 'null' : `'${escHtml(section.id)}'`})">+ Add</button>`
    : '';
// Pass section.id to renderCard:
const cardsHtml = links.map((link, idx) => renderCard(link, personal, idx, section.id)).join('');
```

**`renderCard(link, editable, animIdx, collectionId = null)`** (line 801) — show delete on own contributed links:
```js
const isOwnContribution = !personal && link.contributedBy &&
    currentUser && link.contributedBy.toLowerCase() === currentUser.email.toLowerCase();

const editActions = (editable || isOwnContribution) ? `
    <div class="card-actions">
      ${editable ? `<button class="card-action-btn" onclick="openEditLinkModal('${escHtml(link.id)}');event.stopPropagation()" title="Edit">✎</button>` : ''}
      <button class="card-action-btn danger" onclick="${editable
        ? `deletePersonalLink('${escHtml(link.id)}')`
        : `deleteContributedLink('${escHtml(collectionId)}','${escHtml(link.id)}')`
      };event.stopPropagation()" title="Delete">✕</button>
    </div>` : '';
```

**`openAddLinkModal(collectionId = null)`** — extend to accept target:
```js
function openAddLinkModal(collectionId = null) {
    editingLinkId = null;
    targetCollectionId = collectionId;
    document.getElementById('link-modal-title').textContent = collectionId ? 'Add Link' : 'Add Personal Link';
    // ... clear fields, open modal (unchanged)
}
```

**`saveLinkModal()`** — route to collection API when `targetCollectionId` is set:
```js
if (targetCollectionId) {
    const updated = await apiPost(`/collections/${targetCollectionId}/links`, { name, url, description });
    const idx = allCollections.findIndex(c => c.id === targetCollectionId);
    if (idx >= 0) allCollections[idx] = updated;
    closeLinkModal();
    renderNav();
    renderContent();
} else {
    // existing personal link behavior
}
```

### New `deleteContributedLink(collectionId, linkId)` function
```js
async function deleteContributedLink(collectionId, linkId) {
    if (!confirm('Delete this link?')) return;
    try {
        const updated = await apiDelete(`/collections/${collectionId}/links/${linkId}`);
        const idx = allCollections.findIndex(c => c.id === collectionId);
        if (idx >= 0) allCollections[idx] = updated;
        renderNav();
        renderContent();
    } catch (err) { alert('Failed to delete: ' + err.message); }
}
```

---

## Files to Modify
- `api/src/functions/collections.js`
- `index.html`

## Testing Checklist
1. Regular user (member of a collection) sees `+ Add` on their sections
2. Click `+ Add` → enter name + URL → save → link appears immediately
3. Other members see the new link after refresh
4. Contributor sees `✕` on their link; clicking removes it
5. Other members do NOT see `✕` on someone else's contributed link
6. Admin sees `✕` on all links
7. User NOT in a collection cannot add to it (API returns 403)
