function setMessage(target, message, className) {
    if (!target) return;
    target.innerHTML = `<div class="${className}">${escapeHtml(message)}</div>`;
}

function formatDate(date) {
    if (!date) return '';
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return date;
    return parsed.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

function escapeHtml(text = '') {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** Strip HTML to plain text for card previews. */
function stripHtml(html = '') {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
}

function sanitizeHtml(html = '') {
    if (!html) return '';

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    const allowedTags = [
        'p', 'br', 'strong', 'b', 'em', 'i', 'u',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'blockquote', 'a', 'span', 'div',
    ];
    const allowedAttributes = {
        a: ['href', 'target', 'rel'],
        span: ['style'],
        div: ['style'],
    };

    function sanitizeNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.cloneNode(true);
        }

        if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();

            if (!allowedTags.includes(tagName)) {
                const fragment = document.createDocumentFragment();
                Array.from(node.childNodes).forEach((child) => {
                    const sanitized = sanitizeNode(child);
                    if (sanitized) fragment.appendChild(sanitized);
                });
                return fragment;
            }

            const newElement = document.createElement(tagName);
            const allowedAttrs = allowedAttributes[tagName] || [];
            Array.from(node.attributes).forEach((attr) => {
                if (allowedAttrs.includes(attr.name.toLowerCase())) {
                    if (attr.name === 'href') {
                        const href = attr.value.trim();
                        if (href && !href.startsWith('javascript:') && !href.startsWith('data:')) {
                            newElement.setAttribute(attr.name, href);
                        }
                    } else {
                        newElement.setAttribute(attr.name, attr.value);
                    }
                }
            });

            Array.from(node.childNodes).forEach((child) => {
                const sanitized = sanitizeNode(child);
                if (sanitized) newElement.appendChild(sanitized);
            });

            return newElement;
        }

        return null;
    }

    const fragment = document.createDocumentFragment();
    Array.from(tempDiv.childNodes).forEach((child) => {
        const sanitized = sanitizeNode(child);
        if (sanitized) {
            if (sanitized.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                Array.from(sanitized.childNodes).forEach((node) => fragment.appendChild(node));
            } else {
                fragment.appendChild(sanitized);
            }
        }
    });

    if (fragment.childNodes.length === 0) {
        return escapeHtml(html).replace(/\n/g, '<br>');
    }

    const resultDiv = document.createElement('div');
    resultDiv.appendChild(fragment);
    return resultDiv.innerHTML;
}

function setLoading(container, message) {
    container.innerHTML = `
        <div class="loading-panel">
            <div class="spinner"></div>
            <p>${escapeHtml(message)}</p>
        </div>
    `;
}

function storyDetailUrl(storyId) {
    return `story.html?id=${encodeURIComponent(storyId)}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const footerLink = document.getElementById('contact-link');
    const contactPopup = document.getElementById('contact-popup');
    const contactPopupVideo = document.getElementById('contact-popup-video');
    const contactPopupClose = document.getElementById('contact-popup-close');

    if (!footerLink || !contactPopup || !contactPopupVideo || !contactPopupClose) return;

    const videoSrc = footerLink.dataset.video || '';
    let videoLoaded = false;

    const openContactPopup = () => {
        // Load the video only the first time it's opened, so the page itself stays light.
        if (videoSrc && !videoLoaded) {
            contactPopupVideo.src = videoSrc;
            videoLoaded = true;
        }
        contactPopup.classList.add('is-visible');
        contactPopup.setAttribute('aria-hidden', 'false');
        contactPopupVideo.currentTime = 0;
        contactPopupVideo.play().catch(() => {});
    };

    const closeContactPopup = () => {
        contactPopup.classList.remove('is-visible');
        contactPopup.setAttribute('aria-hidden', 'true');
        contactPopupVideo.pause();
    };

    footerLink.addEventListener('click', (e) => {
        e.preventDefault();
        openContactPopup();
    });

    contactPopupClose.addEventListener('click', closeContactPopup);
    contactPopup.addEventListener('click', (event) => {
        if (event.target === contactPopup || event.target.classList.contains('contact-popup__backdrop')) {
            closeContactPopup();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeContactPopup();
    });
});
