const Liquid = require("liquidjs");
const puppeteer = require("puppeteer");
const path = require("path");
const fetch = require("node-fetch");
const fs = require("fs");
const uuidv4 = require("uuid/v4");

const RESPONSE_TYPE_HTML = "html";
const RESPONSE_TYPE_PDF = "pdf";
const RESPONSE_TYPE_IMAGE = "image";

const PDF_OPTIONS_DEFAULT = {printBackground: true};
const IMAGE_OPTIONS_DEFAULT = {};

const PARAM_NAME_HTML_URL = "htmlUrl";
const PARAM_NAME_HTML_TEMPLATE = "htmlTemplate";
const PARAM_NAME_HTML_CONTENT = "htmlContent";
const PARAM_NAME_RESPONSE_TYPE = "responseType";
const PARAM_NAME_DATA = "data"; 
const PARAM_NAME_OPTIONS = "options";

const OPTION_PRINT_BACKGROUND = "printBackground";

const APP_SETTING_ENVIRONMENT = "Environment";
const ENVIRONMENT_PRODUCTION = "p";

module.exports = async function (context, req) {
    context.log("HTML processing started...");
    var htmlTemplate = null;
    var htmlUrl = null;
    var htmlContent = null;
    var data = null;
    var responseType = null;
    var options = null;

    var optionsforlog = null;
    var dataforlog = null;

    try {
        // first try to read query parameters
        htmlTemplate = req.query[PARAM_NAME_HTML_TEMPLATE];
        htmlUrl = req.query[PARAM_NAME_HTML_URL];
        responseType = req.query[PARAM_NAME_RESPONSE_TYPE];
        
        // if there is a body (POST request), and if there were not query parameters, try to read them from the body, and also read other possible parameters
        if (req.body) {
            if (htmlTemplate==null) {
                htmlTemplate = req.body[PARAM_NAME_HTML_TEMPLATE];
            }
            if (htmlUrl==null) {
                htmlUrl = req.body[PARAM_NAME_HTML_URL];
            }
            if (responseType==null) {
                responseType = req.body[PARAM_NAME_RESPONSE_TYPE];
            }
            htmlContent = req.body[PARAM_NAME_HTML_CONTENT];
            options = req.body[PARAM_NAME_OPTIONS];
            
            data = req.body[PARAM_NAME_DATA];
        }
        // if response type is not specified, consider PDF
        if (responseType==null) {
            responseType = RESPONSE_TYPE_PDF;
        }
        // if options are not specified, use default options (for PDF or IMAGES depending on response type)
        if (options==null) {
            if (responseType===RESPONSE_TYPE_PDF) {                
                options = PDF_OPTIONS_DEFAULT;
            } else {
                options = IMAGE_OPTIONS_DEFAULT;
            }
        }
        // if response type is PDF, and there is no option for printting background specified, set it to true
        if (responseType===RESPONSE_TYPE_PDF && options[OPTION_PRINT_BACKGROUND]==null) {
            options[OPTION_PRINT_BACKGROUND] = true;
        }        
        
        try {
            optionsforlog = JSON.stringify(options);
        } catch(e){
            optionsforlog = options;
        }
        try {
            dataforlog = JSON.stringify(data);
        } catch(e){
            dataforlog = data;
        }
        context.log("html will be processed and result will be returned based on parameters [responseType="+responseType+", htmlTemplate="+htmlTemplate+",htmlUrl="+htmlUrl+",htmlContent="+htmlContent+",options="+optionsforlog+",data="+dataforlog+"]"+"...");
                
        var outputContent = null;
        var contentType = null;
        if ((htmlTemplate!=null || htmlUrl!=null || htmlContent!=null) && (responseType===RESPONSE_TYPE_HTML || responseType===RESPONSE_TYPE_IMAGE || responseType===RESPONSE_TYPE_PDF)) {
            if (responseType===RESPONSE_TYPE_HTML) {
                contentType = "text/html; charset=utf-8";
            } else if (responseType===RESPONSE_TYPE_PDF) {
                contentType = "application/pdf";
            } else if (responseType===RESPONSE_TYPE_IMAGE) {
                if (options.type==="jpeg") {
                    contentType = "image/jpeg";
                } else {
                    contentType = "image/png";
                }
            }
            const engine = new Liquid();
            if (htmlTemplate!=null) {
                context.log("...getting htmlTemplate "+htmlTemplate);
                htmlTemplate = path.resolve(__dirname, htmlTemplate);
                context.log("...using liquid engine to process HTML from template "+htmlTemplate);
                outputContent = await engine.renderFile(htmlTemplate,data);
            } else if (htmlUrl!=null) {
                context.log("...fetching htmlUrl "+htmlUrl);
                const response = await fetch(htmlUrl);
                outputContent = await response.text();
                context.log("...using liquid engine to process HTML from url "+htmlUrl);
                outputContent = engine.parse(outputContent);
                outputContent = await engine.render(outputContent,data);
            } else if (htmlContent!=null) {
                context.log("...parsing htmlContent "+htmlContent);
                outputContent = engine.parse(htmlContent);
                context.log("...using liquid engine to process HTML content "+htmlContent);
                outputContent = await engine.render(outputContent,data);
            }
            var env = process.env[APP_SETTING_ENVIRONMENT];
            context.log("...ENVIRONMENT="+env);
            if (env!==ENVIRONMENT_PRODUCTION) {
                context.log("...setting watermark");
                outputContent = setWatermark(outputContent,context);
            }

            if (responseType!==RESPONSE_TYPE_HTML) {
                context.log("...getting puppeteer browser."+"...");
                const browser = await puppeteer.launch({
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox"
                    ]
                });
                
                context.log("...creating puppeteer new page"+"...");
                const page = await browser.newPage();
                if (htmlTemplate!=null) {
                    if (false) {
                        // This is initial implementation to resolve relative paths...the idea was to write temporary file to the filesystem, however, it is much slower than the 2nd option in else block
                        var bn = path.basename(htmlTemplate);
                        var uuid = uuidv4()
                        var tempHtml = path.dirname(htmlTemplate)+"/temp_"+bn.substring(0,bn.length-path.extname(htmlTemplate).length)+"_"+uuid+".html";
                        context.log("Writting temporary HTML file to "+tempHtml);
                        fs.writeFileSync(tempHtml,outputContent);
                        context.log("...file written to "+tempHtml);                
                        await page.goto("file:///"+tempHtml, { waitUntil: "networkidle2" });
                        fs.unlink(tempHtml,function(error){if (error) {context.log("Failed to delete file "+tempHtml+"!");} else {context.log("File "+tempHtml+" successfully deleted");}});
                    } else {
                        // The following line is written so that the relative paths are properly resolved...however, we don't need to wait for the page to load
                        // If we don't do that, we would have to execute the code above instead this 2 lines of code, and it is much slower
                        await page.goto("file:///"+htmlTemplate); 
                        await page.setContent(outputContent);
                    }
                } else if (htmlContent!=null) {
                    context.log("...setting puppeteer content, content size = "+outputContent.length);
                    await page.setContent(outputContent);
                }                
                if (responseType===RESPONSE_TYPE_PDF) {
                    context.log("...creating pdf with puppeteer"+"...");
                    outputContent = await page.pdf(options);
                } else {
                    context.log("...creating screenshot with puppeteer");
                    outputContent = await page.screenshot(options);
                }
                context.log("...closing puppeteer browser.");
                await browser.close();
            }
            context.log("HTML processing finished...");
            context.res = {
                status: 200,
                body: outputContent,
                headers: {
                    "Content-Type": contentType
                }
            };   
        } else {    
            context.res = {
                status: 400,
                body: "Failed to process html, "+(htmlTemplate==null&&htmlUrl==null&&htmlContent==null ? "non of htmlTemplate, htmlUrl, htmlContent parameters are not specified!" : "invalid responseType parameter value")
            };
        }
    } catch (e) {
        context.res = {
            status: 500,
            body: "Failed to process html based on parameters [responseType="+responseType+", htmlTemplate="+htmlTemplate+",htmlUrl="+htmlUrl+",htmlContent="+htmlContent+",options="+optionsforlog+",data="+dataforlog+"]"+". Error name="+e.name+", Error message: "+e.message+", Error stack="+e.stack
        };
    }   
}

function setWatermark(filestr,context)
{
    if (filestr.indexOf("<html")!=-1 && filestr.indexOf("</html>")!=-1 && filestr.indexOf("<body")!=-1)
    {
        context.log("...handling watermark");
        var ihtmlts = filestr.indexOf("<html");
        var ihtmlte = filestr.indexOf(">", ihtmlts + 5);
        var ibhs = filestr.indexOf("<head");
        var ibhe = filestr.indexOf(">", ibhs + 5);
        if (ibhs > 0 && ibhe > ibhs)
        {
            filestr = filestr.substring(0, ibhe+1) + "\n<title>THIS IS A TEST DOCUMENT</title>" + filestr.substring(ibhe+1);
        } else
        {
            filestr = filestr.substring(0, ihtmlte + 1) + "\n<head><title>THIS IS A TEST DOCUMENT</title></head>" + filestr.substring(ihtmlte + 1);
        }

        var ibts = filestr.indexOf("<body");
        var ibte = filestr.indexOf(">", ibts + 5);
        var ibets = filestr.indexOf("</body");
        if (ibts > 0 && ibte > ibts && ibets > ibte)
        {
            // this is the code if we want to have text background (not working very nice)
            //string watermarkdiv = "<div style=\"position:absolute;z-index:0;background:white;display:block;min-height:50%;min-width:50%;color:yellow\"><p style=\"line-height: 0;color:red;font-size:96px;\">TEST ENVIRONMENT INFO:</p><p style=\"color:red;font-size:48px;\">" + watermark + "</p></div><div style=\"position:absolute;z-index:1\">";
            //filestr = filestr.Substring(0, ibte + 1) + watermarkdiv + filestr.Substring(ibte + 1, ibets - (ibte + 1)) + "</div>" + filestr.Substring(ibets);

            // the following code is for the background image watermark
            var watermarkdiv = "<style>body{background-repeat:no-repeat;background-attachment:fixed;background-size:contain;background-image:url('data:image/png;base64,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')}</style>\n";
            filestr = filestr.substring(0, ibts) + watermarkdiv + filestr.substring(ibts);

        }        
    }
    return filestr;
}
