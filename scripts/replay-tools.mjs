function orderedArguments(value) {
  if (Array.isArray(value)) return value.map(orderedArguments);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, orderedArguments(value[key])]));
}

function callKey(name, args) {
  return JSON.stringify([name, orderedArguments(args)]);
}

export function createToolMock(fixtures) {
  const pending = structuredClone(fixtures).map(fixture => ({
    ...fixture, key: callKey(fixture.name, fixture.args ?? {})
  }));
  const calls = [];
  return {
    async call(name, args = {}) {
      const key = callKey(name, args);
      const index = pending.findIndex(fixture => fixture.key === key);
      if (index < 0) {
        const result = { error: 'No matching mock fixture' };
        calls.push({ name, args: structuredClone(args), result });
        throw Error(result.error + ' for ' + name);
      }
      const [fixture] = pending.splice(index, 1);
      const result = structuredClone(fixture.result);
      calls.push({ name, args: structuredClone(args), result });
      return structuredClone(result);
    },
    get calls() {
      return structuredClone(calls);
    }
  };
}
