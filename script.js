// Get general output div
const pyodideOutputDiv = document.getElementById('pyodide-output');
const loadingMessage = document.getElementById('loading-message');

// **NEW: Get new HTML elements**
const fileUploadInput = document.getElementById('file-upload');
const processButton = document.getElementById('process-button');
const dataframeOutputDiv = document.getElementById('dataframe-output');

let pyodideInstance = null; // To store the loaded Pyodide instance

// Function to append messages to a specified output div
function M_to_div(divElement, message, type = 'log') {
    const p = document.createElement('p');
    p.textContent = message;
    if (type === 'error') {
        p.style.color = 'red';
    } else if (type === 'success') {
        p.style.color = 'green';
    } else if (type === 'html') { // For rendering HTML strings
        p.innerHTML = message; // Use innerHTML for HTML content
    }
    divElement.appendChild(p);
    console.log(message); 
}


async function initializePyodide() {
    // This function will only contain Pyodide and package loading
    // It will be called once.
    try {
        M_to_div(pyodideOutputDiv, "Initializing Pyodide...");
        pyodideInstance = await loadPyodide();
        M_to_div(pyodideOutputDiv, "Pyodide loaded successfully!", "success");

        M_to_div(pyodideOutputDiv, "Loading NumPy and Pandas...");
        await pyodideInstance.loadPackage(["numpy", "pandas"]);
        M_to_div(pyodideOutputDiv, "NumPy and Pandas loaded successfully!", "success");
        
        // Hide loading message and enable process button
        loadingMessage.style.display = 'none';
        processButton.disabled = false; 
        M_to_div(pyodideOutputDiv, "Ready to process files.", "success");

        // You can remove or comment out the data transfer tests from Phase 1 now,
        // or keep them for reference if you like. For clarity, I'll assume they are removed.

    } catch (error) {
        M_to_div(pyodideOutputDiv, `Error during Pyodide initialization: ${error.message}`, 'error');
        loadingMessage.textContent = 'Error initializing Pyodide. Check console.';
        console.error(error);
        processButton.disabled = true; // Keep button disabled if init fails
    }
}

async function handleProcessCSV() {
    if (!pyodideInstance) {
        M_to_div(dataframeOutputDiv, "Pyodide not yet loaded. Please wait.", "error");
        return;
    }
    if (!fileUploadInput.files || fileUploadInput.files.length === 0) {
        M_to_div(dataframeOutputDiv, "Please select a CSV file first.", "error");
        return;
    }

    const file = fileUploadInput.files[0];
    M_to_div(dataframeOutputDiv, `Processing ${file.name}...`);

    const reader = new FileReader();

    reader.onload = async function(event) {
        const csvDataString = event.target.result;
        M_to_div(dataframeOutputDiv, "File read successfully. Sending to Python for parsing...");

        try {
            // Make the CSV string available to Python
            pyodideInstance.globals.set("csv_data_js", csvDataString);

            // Python code to parse CSV and get head()
            // We'll store the DataFrame in Python's global scope as 'df_global'
            const pythonCode = `
                import pandas as pd
                import io

                csv_string = csv_data_js # Get data from JS global scope
                
                # Attempt to read the CSV
                try:
                    df = pd.read_csv(io.StringIO(csv_string))
                    df_global = df # Store in global scope for later use
                    
                    # Return some info: shape and head as HTML
                    shape = df_global.shape
                    head_html = df_global.head().to_html(classes='table table-striped', border=0, justify='left')
                    
                    # Create a result dictionary
                    result = {
                        "message": f"DataFrame created successfully. Shape: {shape[0]} rows, {shape[1]} columns.",
                        "head_html": head_html,
                        "error": None
                    }
                except Exception as e:
                    result = {
                        "message": "Error parsing CSV in Python.",
                        "head_html": None,
                        "error": str(e)
                    }
                result # Return the dictionary
            `;

            let pyResultProxy = await pyodideInstance.runPythonAsync(pythonCode); // Use runPythonAsync for potentially longer operations
            let result = pyResultProxy.toJs({ dict_converter: Object.fromEntries }); // Convert PyProxy dict to JS object
            pyResultProxy.destroy();

            dataframeOutputDiv.innerHTML = ''; // Clear previous output from this div

            if (result.error) {
                M_to_div(dataframeOutputDiv, result.message, "error");
                M_to_div(dataframeOutputDiv, `Python Error: ${result.error}`, "error");
            } else {
                M_to_div(dataframeOutputDiv, result.message, "success");
                M_to_div(dataframeOutputDiv, "First 5 rows of the DataFrame:", "log");
                // Render the HTML table
                const tableContainer = document.createElement('div');
                tableContainer.innerHTML = result.head_html;
                dataframeOutputDiv.appendChild(tableContainer);
            }

        } catch (jsError) {
            M_to_div(dataframeOutputDiv, `JavaScript error during processing: ${jsError.message}`, "error");
            console.error(jsError);
        }
    };

    reader.onerror = function() {
        M_to_div(dataframeOutputDiv, "Error reading the file.", "error");
    };

    reader.readAsText(file); // Read the file as a text string
}

// **Initialization logic**
// Disable button initially
processButton.disabled = true; 
// Start Pyodide initialization when script loads
initializePyodide(); 

// **Event Listener**
processButton.addEventListener('click', handleProcessCSV);