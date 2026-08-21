document.addEventListener('DOMContentLoaded', () => {
    loadStories();
});

async function loadStories() {
    const container = document.getElementById('stories-container');
    setLoading(container, 'Loading stories...');

    try {
        const stories = await fetchStoriesFromSheet();
        const countEl = document.getElementById('story-count');
        if (countEl) countEl.textContent = `${stories.length}+`;

        if (!stories.length) {
            setLoading(container, 'No stories yet. Be the first to share!');
            return;
        }

        renderStories(stories, container);
    } catch (error) {
        console.error(error);
        setLoading(container, 'Something went wrong. Please refresh.');
    }
}

function renderStories(stories, container) {
    container.innerHTML = '';
    const template = document.getElementById('story-card-template');
    if (!template) return;

    stories.forEach((story) => {
        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.story-card');
        const image = clone.querySelector('.story-image');
        const title = clone.querySelector('h3');
        const meta = clone.querySelector('.story-meta');
        const description = clone.querySelector('.story-description');
        const readMoreLink = clone.querySelector('.read-more');

        if (story.thumbnailUrl) {
            const img = document.createElement('img');
            img.src = story.thumbnailUrl;
            img.alt = story.title;
            img.className = 'story-image';
            img.loading = 'lazy';
            image.replaceWith(img);
        } else {
            image.textContent = (story.title || '?').slice(0, 1).toUpperCase();
        }

        title.textContent = story.title || 'Untitled';
        const authorName = story.name || 'Anonymous';
        meta.innerHTML = `<span class="author-badge">${escapeHtml(authorName)}</span> • ${escapeHtml(formatDate(story.createdOn))}`;

        const descHtml = story.description || '';
        if (descHtml.includes('<')) {
            description.innerHTML = sanitizeHtml(descHtml);
        } else {
            description.textContent = descHtml;
        }

        readMoreLink.href = storyDetailUrl(story.id);
        card.addEventListener('click', (e) => {
            if (e.target.closest('a')) return;
            window.location.href = storyDetailUrl(story.id);
        });

        container.appendChild(clone);
    });
}
