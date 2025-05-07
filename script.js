// Get general output div
const pyodideOutputDiv = document.getElementById('pyodide-output');
const loadingMessage = document.getElementById('loading-message');

// Get file processing elements
const fileUploadInput = document.getElementById('file-upload');
const processButton = document.getElementById('process-button');
const dataframeOutputDiv = document.getElementById('dataframe-output');

// Get Analysis Elements
const analysisControlsDiv = document.getElementById('analysis-controls');
const showInfoButton = document.getElementById('show-info-button');
const showDescribeButton = document.getElementById('show-describe-button');
const analysisOutputDiv = document.getElementById('analysis-output');

let pyodideInstance = null; 
let dataFrameLoaded = false; 

// Function to append messages to a specified output div
function M_to_div(divElement, message, type = 'log') {
    const p = document.createElement('p');
    if (type === 'html') {
        p.innerHTML = message; 
    } else {
        p.textContent = message;
    }

    if (type === 'error') {
        p.style.color = 'red';
    } else if (type === 'success') {
        p.style.color = 'green';
    }
    
    // Clear previous content only if it's not an append operation
    // For simplicity now, we'll handle clearing in the calling functions if needed.
    // If a div should only show one message, clear it before calling M_to_div or make M_to_div clear it.
    // For now, it appends.

    divElement.appendChild(p);
    if (type !== 'html') { // Avoid logging potentially large HTML strings to console directly
        console.log(message);
    } else {
        console.log("HTML content rendered.");
    }
}


async function initializePyodide() {
    try {
        M_to_div(pyodideOutputDiv, "Initializing Pyodide...");
        pyodideInstance = await loadPyodide();
        M_to_div(pyodideOutputDiv, "Pyodide loaded successfully!", "success");

        M_to_div(pyodideOutputDiv, "Loading NumPy and Pandas...");
        await pyodideInstance.loadPackage(["numpy", "pandas"]);
        M_to_div(pyodideOutputDiv, "NumPy and Pandas loaded successfully!", "success");
        
        loadingMessage.style.display = 'none';
        processButton.disabled = false; 
        M_to_div(pyodideOutputDiv, "Ready to process files.", "success");

    } catch (error) {
        M_to_div(pyodideOutputDiv, `Error during Pyodide initialization: ${error.message}`, 'error');
        loadingMessage.textContent = 'Error initializing Pyodide. Check console.';
        console.error(error);
        processButton.disabled = true;
    }
}

function setAnalysisButtonsDisabled(isDisabled) {
    showInfoButton.disabled = isDisabled;
    showDescribeButton.disabled = isDisabled;
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
    dataframeOutputDiv.innerHTML = ''; // Clear previous df output
    analysisOutputDiv.innerHTML = '';  // Clear previous analysis output
    M_to_div(dataframeOutputDiv, `Processing ${file.name}...`);
    
    setAnalysisButtonsDisabled(true); 
    dataFrameLoaded = false;

    const reader = new FileReader();
    reader.onload = async function(event) {
        const csvDataString = event.target.result;
        M_to_div(dataframeOutputDiv, "File read successfully. Sending to Python for parsing...");

        try {
            pyodideInstance.globals.set("csv_data_js", csvDataString);

            const pythonCode = `
                import pandas as pd
                import io
                
                result_dict = {
                    "message": "",
                    "head_html": None,
                    "error": None,
                    "df_loaded_successfully": False
                }

                try:
                    df = pd.read_csv(io.StringIO(csv_data_js))
                    globals()['df_global'] = df # Store in global scope
                    
                    shape = df.shape
                    head_html = df.head().to_html(classes='table table-striped', border=0, justify='left')
                    
                    result_dict["message"] = f"DataFrame created. Shape: {shape[0]} rows, {shape[1]} columns."
                    result_dict["head_html"] = head_html
                    result_dict["df_loaded_successfully"] = True
                except Exception as e:
                    result_dict["message"] = "Error parsing CSV in Python."
                    result_dict["error"] = str(e)
                
                result_dict # Return the dictionary
            `;

            let pyResultProxy = await pyodideInstance.runPythonAsync(pythonCode);
            let result = pyResultProxy.toJs({ dict_converter: Object.fromEntries });
            pyResultProxy.destroy();

            if (result.error) {
                M_to_div(dataframeOutputDiv, result.message, "error");
                M_to_div(dataframeOutputDiv, `Python Error: ${result.error}`, "error");
                dataFrameLoaded = false;
            } else {
                M_to_div(dataframeOutputDiv, result.message, "success");
                M_to_div(dataframeOutputDiv, "First 5 rows of the DataFrame:", "log");
                
                const tableContainer = document.createElement('div'); // Use a div to contain the table
                tableContainer.innerHTML = result.head_html;
                dataframeOutputDiv.appendChild(tableContainer);
                
                dataFrameLoaded = true; 
                setAnalysisButtonsDisabled(false); 
            }

        } catch (jsError) {
            M_to_div(dataframeOutputDiv, `JavaScript error during processing: ${jsError.message}`, "error");
            console.error(jsError);
            dataFrameLoaded = false;
        }
    };

    reader.onerror = function() {
        M_to_div(dataframeOutputDiv, "Error reading the file.", "error");
        dataFrameLoaded = false;
    };

    reader.readAsText(file);
}

async function handleShowInfo() {
    if (!dataFrameLoaded || !pyodideInstance) {
        M_to_div(analysisOutputDiv, "No DataFrame loaded or Pyodide not ready.", "error");
        return;
    }
    analysisOutputDiv.innerHTML = ''; // Clear previous analysis output
    M_to_div(analysisOutputDiv, "Fetching DataFrame.info()...");

    try {
        const pythonCode = `
            import io
            import sys

            result_dict = {"output": "", "is_error": False}

            if 'df_global' not in globals():
                result_dict["output"] = "Error: DataFrame 'df_global' not found."
                result_dict["is_error"] = True
            else:
                old_stdout = sys.stdout
                sys.stdout = captured_output = io.StringIO()
                try:
                    globals()['df_global'].info() # Access df_global from globals()
                    sys.stdout = old_stdout 
                    result_dict["output"] = captured_output.getvalue()
                except Exception as e:
                    sys.stdout = old_stdout 
                    result_dict["output"] = f"Error executing df.info(): {str(e)}"
                    result_dict["is_error"] = True
            
            result_dict
        `;
        let pyResultProxy = await pyodideInstance.runPythonAsync(pythonCode);
        let result = pyResultProxy.toJs({ dict_converter: Object.fromEntries });
        pyResultProxy.destroy();
        
        if(result.is_error) {
            M_to_div(analysisOutputDiv, result.output, "error");
        } else {
            const pre = document.createElement('pre');
            pre.textContent = result.output;
            analysisOutputDiv.appendChild(pre);
        }
    } catch (jsError) {
        M_to_div(analysisOutputDiv, `JavaScript error: ${jsError.message}`, "error");
        console.error(jsError);
    }
}

async function handleShowDescribe() {
    if (!dataFrameLoaded || !pyodideInstance) {
        M_to_div(analysisOutputDiv, "No DataFrame loaded or Pyodide not ready.", "error");
        return;
    }
    analysisOutputDiv.innerHTML = ''; 
    M_to_div(analysisOutputDiv, "Fetching DataFrame.describe()...");

    try {
        const pythonCode = `
            result_dict = {"html": "", "is_error": False}
            if 'df_global' not in globals():
                result_dict["html"] = "<p style='color:red;'>Error: DataFrame 'df_global' not found.</p>"
                result_dict["is_error"] = True
            else:
                try:
                    result_dict["html"] = globals()['df_global'].describe().to_html(classes='table table-striped', border=0, justify='left')
                except Exception as e:
                    result_dict["html"] = f"<p style='color:red;'>Error executing df.describe(): {str(e)}</p>"
                    result_dict["is_error"] = True
            result_dict
        `;
        let pyResultProxy = await pyodideInstance.runPythonAsync(pythonCode);
        let result = pyResultProxy.toJs({ dict_converter: Object.fromEntries });
        pyResultProxy.destroy();

        // Use M_to_div with 'html' type to render the table or error message
        M_to_div(analysisOutputDiv, result.html, result.is_error ? "error" : "html");

    } catch (jsError) {
        M_to_div(analysisOutputDiv, `JavaScript error: ${jsError.message}`, "error");
        console.error(jsError);
    }
}

// Initialization logic
processButton.disabled = true; 
setAnalysisButtonsDisabled(true); 
initializePyodide(); 

// Event Listeners
processButton.addEventListener('click', handleProcessCSV);
showInfoButton.addEventListener('click', handleShowInfo);
showDescribeButton.addEventListener('click', handleShowDescribe);