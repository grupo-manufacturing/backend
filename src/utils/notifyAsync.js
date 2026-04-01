function notifyAsync(task, label = 'async notification') {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`${label} error:`, error?.message || error);
    });
}

module.exports = notifyAsync;
