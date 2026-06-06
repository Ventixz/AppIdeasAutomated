// Bin2Dec — convert a binary string to its decimal value.
//
// Project constraints from the app-ideas spec:
//   - Arrays cannot be used to store the binary digits.
//   - The conversion must use a single mathematical function (a power).
// We honour both by walking the string from the least-significant digit and
// accumulating digit * 2^position with Math.pow.

function binaryToDecimal(binary) {
  let decimal = 0;
  for (let i = 0; i < binary.length; i++) {
    // Most-significant digit is at index 0, so its power is length-1-i.
    const digit = Number(binary.charAt(i));
    const power = binary.length - 1 - i;
    decimal += digit * Math.pow(2, power);
  }
  return decimal;
}

function wireUp() {
  const input = document.getElementById("binary-input");
  const output = document.getElementById("decimal-output");
  const errorMessage = document.getElementById("error-message");

  function handleInput() {
    const value = input.value.trim();

    if (value === "") {
      errorMessage.textContent = "";
      output.textContent = "0";
      return;
    }

    if (!/^[01]+$/.test(value)) {
      errorMessage.textContent = "Only 0s and 1s are allowed.";
      output.textContent = "—";
      return;
    }

    errorMessage.textContent = "";
    output.textContent = binaryToDecimal(value).toString();
  }

  input.addEventListener("input", handleInput);
}

if (typeof document !== "undefined") {
  wireUp();
}

// Expose for testing in non-browser environments (e.g. Node).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { binaryToDecimal };
}
