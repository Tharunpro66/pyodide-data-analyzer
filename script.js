// Get references to HTML elements
const initialInstruction = document.getElementById('initial-instruction');
const loadingMessage = document.getElementById('loading-message');
const pyodideOutputDiv = document.getElementById('pyodide-output');

const fileUploadInput = document.getElementById('file-upload');
const processButton = document.getElementById('process-button');
const dataframeOutputDiv = document.getElementById('dataframe-output');

const showInfoButton = document.getElementById('show-info-button');
const showDescribeButton = document.getElementById('show-describe-button');
const analysisOutputDiv = document.getElementById('analysis-output');

const columnSelect = document.getElementById('column-select');
const generateHistogramButton = document.getElementById('generate-histogram-button');
const chartOutputDiv = document.getElementById('chart-output');

// Global state variables
let pyodideInstance = null;
let dataFrameLoaded = false;

/**
 * Appends a styled message or HTML content to a specified DOM element.
 * @param {HTMLElement} divElement The DOM element to append to.
 * @param {string} message The message string or HTML string.
 * @param {'log'|'success'|'error'|'html'|'pre'} type The type of message, for styling.
 * @param {boolean} clearPrevious If true, clears the divElement's existing content.
 */
function M_to_div(divElement, message, type = 'log', clearPrevious = false) {
    if (!divElement) {
        console.error("M_to_div: Target divElement is null or undefined.");
        return;
    }
    if (clearPrevious) {
        divElement.innerHTML = '';
    }

    const wrapper = document.createElement('div'); // Use a div wrapper for all types

    if (type === 'html') {
        wrapper.innerHTML = message;
    } else if (type === 'pre') {
        const preElement = document.createElement('pre');
        preElement.textContent = message;
        wrapper.appendChild(preElement);
    } else {
        const pElement = document.createElement('p');
        pElement.textContent = message;
        wrapper.appendChild(pElement);
    }

    // Add appropriate class to the wrapper
    if (type === 'error') wrapper.classList.add('error-message');
    else if (type === 'success') wrapper.classList.add('success-message');
    else wrapper.classList.add('log-message'); // Default for 'log', 'pre', 'html' (unless error/success)
    
    divElement.appendChild(wrapper);

    // Console logging for non-HTML/PRE or if it's an error
    if (type !== 'html' && type !== 'pre') {
        console.log(message);
    } else if (type === 'error') {
        console.error("Error displayed (HTML/PRE):", message.substring(0, 200) + "..."); // Log truncated HTML/PRE errors
    }
}

/**
 * Updates the status message in a specific element.
 * @param {HTMLElement} element The DOM element to update.
 * @param {string} message The message to display.
 * @param {boolean} isProcessing If true, indicates an ongoing process (future use for spinners).
 */
function updateStatus(element, message, isProcessing = false) {
    if (element) {
        element.innerHTML = message;
        // Future: Add/remove spinner class based on isProcessing
    }
}

/**
 * Initializes Pyodide and loads necessary Python packages.
 */
async function initializePyodide() {
    try {
        updateStatus(loadingMessage, "Initializing Pyodide core...");
        pyodideInstance = await loadPyodide();
        M_to_div(pyodideOutputDiv, "Pyodide core loaded successfully.", "success");

        updateStatus(loadingMessage, "Loading Python packages (NumPy, Pandas, Matplotlib)... This may take a moment.");
        await pyodideInstance.loadPackage(["numpy", "pandas", "matplotlib"]);
        M_to_div(pyodideOutputDiv, "NumPy, Pandas, and Matplotlib loaded successfully!", "success");
        
        updateStatus(loadingMessage, "Python environment ready!");
        setTimeout(() => { 
            if(loadingMessage) loadingMessage.style.display = 'none'; 
            if(initialInstruction) initialInstruction.style.display = 'none';
        }, 2000);

        processButton.disabled = false;
        M_to_div(pyodideOutputDiv, "Ready to process files.", "success");

    } catch (error) {
        M_to_div(pyodideOutputDiv, `FATAL: Pyodide initialization failed: ${error.message}`, 'error');
        updateStatus(loadingMessage, `Initialization Error: ${error.message}. Please refresh or check console.`, false);
        if (loadingMessage) loadingMessage.classList.add('error-message'); // Make error prominent
        console.error("Pyodide Init Error:", error);
        processButton.disabled = true;
    }
}

/**
 * Enables or disables analysis-related buttons.
 * @param {boolean} isDisabled True to disable, false to enable.
 */
function setAnalysisButtonsDisabled(isDisabled) {
    showInfoButton.disabled = isDisabled;
    showDescribeButton.disabled = isDisabled;
}

/**
 * Enables or disables charting-related controls.
 * @param {boolean} isDisabled True to disable, false to enable.
 */
function setChartingControlsDisabled(isDisabled) {
    columnSelect.disabled = isDisabled;
    generateHistogramButton.disabled = isDisabled;
}

/**
 * Populates the column selection dropdown with numerical columns from the DataFrame.
 */
async function populateColumnSelect() {
    if (!dataFrameLoaded || !pyodideInstance) {
        setChartingControlsDisabled(true);
        return;
    }

    try {
        const pythonCode = `
            import numpy as np # Required for np.number
            if 'df_global' in globals():
                numerical_cols = df_global.select_dtypes(include=np.number).columns.tolist()
                result = {"columns": numerical_cols, "error": None}
            else:
                result = {"columns": [], "error": "DataFrame 'df_global' not found."}
            result
        `;
        let pyResultProxy = await pyodideInstance.runPythonAsync(pythonCode);
        let result = pyResultProxy.toJs({ dict_converter: Object.fromEntries });
        pyResultProxy.destroy();

        columnSelect.innerHTML = ''; // Clear existing options

        if (result.error) {
            M_to_div(chartOutputDiv, `Error populating columns: ${result.error}`, 'error');
            setChartingControlsDisabled(true);
            return;
        }

        if (result.columns.length === 0) {
            let option = document.createElement('option');
            option.textContent = "No numerical columns found";
            option.disabled = true;
            columnSelect.appendChild(option);
            setChartingControlsDisabled(true);
        } else {
            result.columns.forEach(colName => {
                let option = document.createElement('option');
                option.value = colName;
                option.textContent = colName;
                columnSelect.appendChild(option);
            });
            setChartingControlsDisabled(false);
        }
    } catch (e) {
        M_to_div(chartOutputDiv, `JS error populating column select: ${e.message}`, 'error');
        setChartingControlsDisabled(true);
    }
}

/**
 * Handles CSV file processing: reads the file, sends to Python for parsing,
 * and displays initial DataFrame info.
 */
async function handleProcessCSV() {
    if (!pyodideInstance) {
        M_to_div(dataframeOutputDiv, "Pyodide not yet loaded. Please wait.", "error", true);
        return;
    }
    if (!fileUploadInput.files || fileUploadInput.files.length === 0) {
        M_to_div(dataframeOutputDiv, "Please select a CSV file first.", "error", true);
        return;
    }

    const file = fileUploadInput.files[0];
    M_to_div(dataframeOutputDiv, `Processing ${file.name}...`, 'log', true);
    analysisOutputDiv.innerHTML = ''; 
    chartOutputDiv.innerHTML = ''; 
    setAnalysisButtonsDisabled(true); 
    setChartingControlsDisabled(true); 
    dataFrameLoaded = false;
    columnSelect.innerHTML = '<option value="">- Select -</option>';

    if (file.size > 50 * 1024 * 1024) { // 50MB limit example
        M_to_div(dataframeOutputDiv, "Warning: File is large (> 50MB). Processing may be slow or unstable.", 'log'); // Log as warning, not error yet
    }
    if (file.size === 0) {
        M_to_div(dataframeOutputDiv, "File is empty.", "error"); // No need to clear again
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(event) {
        const csvDataString = event.target.result;
        if (!csvDataString || csvDataString.trim() === "") {
            M_to_div(dataframeOutputDiv, "CSV file content is empty or only whitespace.", "error");
            return;
        }
        M_to_div(dataframeOutputDiv, "File read. Parsing with Pandas...", 'log');
        
        let tempStatusP = document.createElement('p'); // Temporary processing message
        tempStatusP.textContent = "Python is processing the CSV...";
        tempStatusP.className = 'log-message';
        dataframeOutputDiv.appendChild(tempStatusP);

        try {
            pyodideInstance.globals.set("csv_data_js", csvDataString);
            const pythonCode = `
                import pandas as pd
                import io
                
                csv_string = csv_data_js
                result = { "message": "", "head_html": None, "error": None, "df_loaded_successfully": False }
                
                try:
                    if not csv_string.strip(): # Check if string is empty after stripping whitespace
                        result["error"] = "CSV data is effectively empty."
                    else:
                        df = pd.read_csv(io.StringIO(csv_string))
                        if df.empty:
                            result["error"] = "Parsed DataFrame is empty. Please check CSV format or content."
                        else:
                            globals()['df_global'] = df # Store DataFrame globally in Python
                            shape = df.shape
                            result["message"] = f"DataFrame created successfully. Shape: {shape[0]} rows, {shape[1]} columns."
                            result["head_html"] = df.head().to_html(classes='table table-striped', border=0, justify='left')
                            result["df_loaded_successfully"] = True
                except Exception as e:
                    result["error"] = f"Pandas parsing error: {str(e)}"
                
                result # Return the dictionary
            `;

            let pyResultProxy = await pyodideInstance.runPythonAsync(pythonCode);
            let result = pyResultProxy.toJs({ dict_converter: Object.fromEntries });
            pyResultProxy.destroy();
            
            if(tempStatusP.parentNode) tempStatusP.remove(); // Remove temporary processing message

            if (result.error) {
                M_to_div(dataframeOutputDiv, result.error, "error");
                dataFrameLoaded = false;
            } else {
                M_to_div(dataframeOutputDiv, result.message, "success");
                M_to_div(dataframeOutputDiv, "First 5 rows:", "log");
                M_to_div(dataframeOutputDiv, result.head_html, "html");
                dataFrameLoaded = true; 
                setAnalysisButtonsDisabled(false); 
                await populateColumnSelect(); 
            }
        } catch (jsError) {
            if(tempStatusP.parentNode) tempStatusP.remove();
            M_to_div(dataframeOutputDiv, `JavaScript error during CSV processing: ${jsError.message}`, "error");
            console.error("JS CSV Processing Error:", jsError);
        }
    };
    reader.onerror = function(errorEvent) {
        M_to_div(dataframeOutputDiv, `FileReader error: ${errorEvent.target.error.name} - ${errorEvent.target.error.message}`, "error");
        console.error("FileReader Error:", errorEvent.target.error);
    };
    reader.readAsText(file);
}

/**
 * Fetches and displays DataFrame.info().
 */
async function handleShowInfo() {
    if (!dataFrameLoaded || !pyodideInstance) {
        M_to_div(analysisOutputDiv, "No DataFrame loaded or Pyodide not ready.", "error", true);
        return;
    }
    M_to_div(analysisOutputDiv, "Fetching DataFrame.info()...", 'log', true);

    try {
        const pythonCodeForInfo = `
            import io
            import sys
            result = {"output": "", "is_error": False}
            if 'df_global' not in globals():
                result["output"] = "Error: DataFrame 'df_global' not found."
                result["is_error"] = True
            else:
                old_stdout = sys.stdout
                sys.stdout = captured_output = io.StringIO()
                try:
                    df_global.info()
                    result["output"] = captured_output.getvalue()
                except Exception as e:
                    result["output"] = f"Error executing df.info(): {str(e)}"
                    result["is_error"] = True
                finally: # Ensure stdout is always reset
                    sys.stdout = old_stdout
            result
        `;
        let pyResultProxy = await pyodideInstance.runPythonAsync(pythonCodeForInfo);
        let result = pyResultProxy.toJs({ dict_converter: Object.fromEntries });
        pyResultProxy.destroy();
            
        M_to_div(analysisOutputDiv, result.output, (result.is_error ? "error" : "pre"));

    } catch (jsError) {
        M_to_div(analysisOutputDiv, `JavaScript error: ${jsError.message}`, "error");
        console.error("JS Show Info Error:", jsError);
    }
}

/**
 * Fetches and displays DataFrame.describe().
 */
async function handleShowDescribe() {
    if (!dataFrameLoaded || !pyodideInstance) {
        M_to_div(analysisOutputDiv, "No DataFrame loaded or Pyodide not ready.", "error", true);
        return;
    }
    M_to_div(analysisOutputDiv, "Fetching DataFrame.describe()...", 'log', true);

    try {
        const pythonCodeForDescribe = `
            result = {"html": "", "is_error": False}
            if 'df_global' not in globals():
                result["html"] = "Error: DataFrame 'df_global' not found."
                result["is_error"] = True
            else:
                try:
                    result["html"] = df_global.describe().to_html(classes='table table-striped', border=0, justify='left')
                except Exception as e:
                    result["html"] = f"Error executing df.describe(): {str(e)}"
                    result["is_error"] = True
            result
        `;
        let pyResultProxy = await pyodideInstance.runPythonAsync(pythonCodeForDescribe);
        let result = pyResultProxy.toJs({ dict_converter: Object.fromEntries });
        pyResultProxy.destroy();

        M_to_div(analysisOutputDiv, result.html, (result.is_error ? "error" : "html"));

    } catch (jsError) {
        M_to_div(analysisOutputDiv, `JavaScript error: ${jsError.message}`, "error");
        console.error("JS Show Describe Error:", jsError);
    }
}

/**
 * Generates and displays a histogram for a selected column.
 */
async function handleGenerateHistogram() {
    if (!dataFrameLoaded || !pyodideInstance) {
        M_to_div(chartOutputDiv, "No DataFrame loaded or Pyodide not ready.", "error", true);
        return;
    }
    const selectedColumn = columnSelect.value;
    if (!selectedColumn) {
        M_to_div(chartOutputDiv, "Please select a column for the histogram.", "error", true);
        return;
    }

    M_to_div(chartOutputDiv, `Generating histogram for column: ${selectedColumn}...`, 'log', true);

    try {
        pyodideInstance.globals.set("selected_column_js", selectedColumn);
        const pythonCodeForHistogram = `
            import matplotlib
            matplotlib.use('Agg') # Non-interactive backend
            import matplotlib.pyplot as plt
            import io
            import base64
            import pandas as pd # Ensure pandas is available for pd.api.types

            plot_result = {"b64_image": None, "error": None}

            if 'df_global' not in globals():
                plot_result["error"] = "DataFrame 'df_global' not found."
            elif selected_column_js not in df_global.columns:
                plot_result["error"] = f"Column '{selected_column_js}' not found in DataFrame."
            else:
                fig = None # Initialize fig to None
                try:
                    if pd.api.types.is_numeric_dtype(df_global[selected_column_js]):
                        fig, ax = plt.subplots(figsize=(8, 5))
                        df_global[selected_column_js].hist(ax=ax, bins='auto', grid=False)
                        ax.set_title(f'Histogram of {selected_column_js}')
                        ax.set_xlabel(selected_column_js)
                        ax.set_ylabel('Frequency')
                        
                        img_bytes = io.BytesIO()
                        plt.savefig(img_bytes, format='png', bbox_inches='tight')
                        img_bytes.seek(0)
                        img_b64 = base64.b64encode(img_bytes.read()).decode('utf-8')
                        plot_result["b64_image"] = f"data:image/png;base64,{img_b64}"
                    else:
                        plot_result["error"] = f"Column '{selected_column_js}' is not numeric and cannot be used for a histogram."
                except Exception as e:
                    plot_result["error"] = f"Error generating plot: {str(e)}"
                finally:
                    if fig: # Only close if a figure was created
                        plt.close(fig)
            plot_result
        `;
        let pyResultProxy = await pyodideInstance.runPythonAsync(pythonCodeForHistogram);
        let result = pyResultProxy.toJs({ dict_converter: Object.fromEntries });
        pyResultProxy.destroy();

        if (result.error) {
            M_to_div(chartOutputDiv, result.error, "error");
        } else if (result.b64_image) {
            const img = document.createElement('img');
            img.src = result.b64_image;
            img.alt = `Histogram of ${selectedColumn}`;
            // img.style.maxWidth = "100%"; // Already handled by CSS
            // img.style.border = "1px solid #ccc";
            chartOutputDiv.appendChild(img);
            M_to_div(chartOutputDiv, `Histogram for '${selectedColumn}' generated.`, "success");
        } else {
            M_to_div(chartOutputDiv, "Unknown error: No image or error returned from Python.", "error");
        }
    } catch (jsError) {
        M_to_div(chartOutputDiv, `JavaScript error during chart generation: ${jsError.message}`, "error");
        console.error("JS Chart Error:", jsError);
    }
}

// --- Initialization ---
// Disable buttons that require Pyodide or data
processButton.disabled = true; 
setAnalysisButtonsDisabled(true); 
setChartingControlsDisabled(true); 

// Start Pyodide initialization when script loads
initializePyodide(); 

// --- Event Listeners ---
processButton.addEventListener('click', handleProcessCSV);
showInfoButton.addEventListener('click', handleShowInfo);
showDescribeButton.addEventListener('click', handleShowDescribe);
generateHistogramButton.addEventListener('click', handleGenerateHistogram);