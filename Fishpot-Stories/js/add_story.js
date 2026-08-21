const MAX_STORY_LENGTH = () => APP_CONFIG.MAX_FULL_STORY_LENGTH;

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('add-story-form');
    if (form) form.addEventListener('submit', handleSubmit);

    initRichEditor();
});

function initRichEditor() {
    const editor = document.getElementById('full-story-editor');
    const toolbar = document.getElementById('editor-toolbar');
    if (!editor || !toolbar) return;

    toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-command]');
        if (!btn) return;
        e.preventDefault();
        const command = btn.dataset.command;
        const value = btn.dataset.value || null;
        editor.focus();
        document.execCommand(command, false, value);
    });

    editor.addEventListener('paste', (e) => {
        e.preventDefault();
        const html = (e.clipboardData || window.clipboardData).getData('text/html');
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        const toInsert = html && html.trim() ? sanitizeHtml(html) : escapeHtml(text).replace(/\n/g, '<br>');
        document.execCommand('insertHTML', false, toInsert);
    });
}

function getEditorHtml() {
    const editor = document.getElementById('full-story-editor');
    if (!editor) return '';
    const html = editor.innerHTML.trim();
    if (!html || html === '<br>' || html === '<div><br></div>') return '';
    return html;
}

function validateEditor() {
    const editor = document.getElementById('full-story-editor');
    const html = getEditorHtml();
    const plain = editor ? (editor.textContent || '').trim() : '';

    if (!plain) {
        return { valid: false, message: 'Full story is required.' };
    }

    if (html.length > MAX_STORY_LENGTH()) {
        return {
            valid: false,
            message: `Your story is too long (${html.length.toLocaleString()} characters). The maximum allowed is ${MAX_STORY_LENGTH().toLocaleString()} characters. Please shorten your story and try again.`,
        };
    }

    return { valid: true, html };
}

async function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const messageDiv = document.getElementById('add-message');
    const submitBtn = form.querySelector('button[type="submit"]');

    const name = document.getElementById('author_name').value.trim();
    const title = document.getElementById('title').value.trim();
    const description = document.getElementById('description').value.trim();
    const thumbnailUrl = document.getElementById('thumbnail_url').value.trim();

    if (!name || !title || !description) {
        setMessage(messageDiv, 'Please fill in all required fields.', 'error-message');
        return;
    }

    const editorCheck = validateEditor();
    if (!editorCheck.valid) {
        setMessage(messageDiv, editorCheck.message, 'error-message');
        return;
    }

    const payload = {
        id: String(Date.now()),
        name,
        title,
        description,
        thumbnailUrl,
        fullStory: editorCheck.html,
        createdOn: new Date().toISOString(),
    };

    setMessage(messageDiv, 'Publishing your story...', 'success-message');
    if (submitBtn) submitBtn.disabled = true;

    try {
        await submitStoryToSheet(payload);
        form.reset();
        const editor = document.getElementById('full-story-editor');
        if (editor) editor.innerHTML = '';
        setMessage(
            messageDiv,
            'Story published successfully! It may take a moment to appear on the home page.',
            'success-message'
        );
    } catch (error) {
        console.error(error);
        setMessage(messageDiv, error.message, 'error-message');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}
