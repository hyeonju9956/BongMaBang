export function createSearch(input, clearButton, onChange) {
  function update() {
    const query = input.value.trim().toLowerCase();
    clearButton.hidden = !query;
    onChange(query);
  }

  input.addEventListener("input", update);
  clearButton.addEventListener("click", () => {
    input.value = "";
    update();
    input.focus();
  });

  return {
    set(value) {
      input.value = value;
      update();
    },
    get value() {
      return input.value.trim();
    }
  };
}
