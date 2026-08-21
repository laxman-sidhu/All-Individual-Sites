document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const storyId = params.get('id');
    if (!storyId) {
        showError('No story specified.');
        return;
    }
    loadStory(storyId);
});

async function loadStory(storyId) {
    const container = document.getElementById('story-detail');
    setLoading(container, 'Loading story...');

    try {
        const story = await fetchStoryById(storyId);
        if (!story) {
            showError('Story not found.');
            return;
        }
        renderStory(story, container);
    } catch (error) {
        console.error(error);
        showError('Something went wrong. Please try again later.');
    }
}

function renderStory(story, container) {
    document.title = `${story.title || 'Story'} • Fishpot Stories`;

    const thumbBlock = story.thumbnailUrl
        ? `<figure class="story-detail__media"><img class="story-detail__thumb" src="${escapeHtml(story.thumbnailUrl)}" alt="${escapeHtml(story.title)}"></figure>`
        : '';

    container.innerHTML = `
        ${thumbBlock}
        <h1>${escapeHtml(story.title || 'Untitled')}</h1>
        <p class="story-meta">By ${escapeHtml(story.name || 'Anonymous')} • ${formatDate(story.createdOn)}</p>
        <div id="story-body" class="story-content-html"></div>
        <a class="btn ghost story-back" href="index.html">← Back to all stories</a>
    `;

    const body = document.getElementById('story-body');
    body.innerHTML = story.fullStory || '';
}

function showError(message) {
    const container = document.getElementById('story-detail');
    container.innerHTML = `
        <p class="story-error">${escapeHtml(message)}</p>
        <a class="btn primary" href="index.html">Go home</a>
    `;
}
