// Get the output div
const outputDiv = document.getElementById('output');
const loadingMessage = document.querySelector('p'); // Get the loading message paragraph

// Function to append messages to our output div
function M_to_output(message, type = 'log') {
    const p = document.createElement('p');
    p.textContent = message;
    if (type === 'error') {
        p.style.color = 'red';
    } else if (type === 'success') {
        p.style.color = 'green';
    }
    outputDiv.appendChild(p);
    console.log(message); // Also log to browser console
}

async function main() {
    try {
        M_to_output("Initializing Pyodide...");
        // To use a specific version of Pyodide:
        // let pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/" });
        // Or, to use the version from the CDN link in index.html:
        let pyodide = await loadPyodide();
        M_to_output("Pyodide loaded successfully!", "success");
        loadingMessage.style.display = 'none'; // Hide initial loading message

        M_to_output("Running Python code...");
        // Example: Running a simple Python script
        // To capture Python's print statements, we can redirect stdout.
        // However, for simple return values, runPython is easier.
        // For print(), we can set up a stdout callback during loadPyodide,
        // or use pyodide.runPython with sys.stdout redirection.

        // Simple way to capture print for this example:
        pyodide.runPython(`
            import sys
            import io
            sys.stdout = io.StringIO() # Redirect stdout

            print("Hello from Python inside Pyodide!")
            print(f"Python version: {sys.version}")

            # Get the captured output
            captured_output = sys.stdout.getvalue()
        `);

        // Retrieve the captured output from Python's global scope
        let pythonOutput = pyodide.globals.get('captured_output');
        M_to_output("Python script executed. Output:", "success");
        M_to_output(pythonOutput);


        // Example of getting a return value directly
        let result = pyodide.runPython(`
            a = 10
            b = 20
            a + b
        `);
        M_to_output(`Python calculation result (10 + 20): ${result}`, "success");


    } catch (error) {
        M_to_output(`Error loading or running Pyodide: ${error}`, 'error');
        loadingMessage.textContent = 'Error loading Pyodide. Check console.';
        console.error(error);
    }
}

// Call the main async function
main();