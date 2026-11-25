// كل ملف قصة يستدعي registerStory({...}) — انظر stories/_template.js
window.STORIES = [];
window.registerStory = function (story) {
  window.STORIES.push(story);
};
