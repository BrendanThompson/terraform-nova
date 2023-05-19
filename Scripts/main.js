
var langserver = null;

exports.activate = function() {
    // Do work when the extension is activated
    langserver = new TerraformLanguageServer();
}

exports.deactivate = function() {
    // Clean up state before the extension is deactivated
    if (langserver) {
        langserver.deactivate();
        langserver = null;
    }
}


class TerraformLanguageServer {
    constructor() {
        this.languageClient = null;
        
        nova.config.onDidChange('terraform-nova.language-server-path', (path) => {
            this.start(path);
        }, this);
        
        // Observe the configuration setting for the server's location, and restart the server on change
        nova.config.observe('terraform-nova.language-server-path', function(path) {
            this.start(path);
        }, this);
        
        this.start();
        
        let langserver = this;
    }
    
    deactivate() {
        this.stop();
    }
    
    start(path) {
        if (this.languageClient) {
            this.languageClient.stop();
            nova.subscriptions.remove(this.languageClient);
        }
        
        // Use the default server path
        if (!path) {
            path = '/opt/homebrew/bin/terraform-ls';
        }
        
        
        
        // Create the client
        var serverOptions = {
            path: path,
            args: ['serve']
        };
        
        var clientOptions = {
            // The set of document syntaxes for which the server is valid
            syntaxes: ['Terraform', 'tf', 'terraform']
        };
        
        var client = new LanguageClient('terraform-ls', 'Terraform Language Server', serverOptions, clientOptions);
        
        try {
            console.log("Starting `terraform-ls` server at: '" + serverOptions.path + "' with: '" + serverOptions.args.join(" "))
            
            // Start the client
            client.start();
            
            // Add the client to the subscriptions to be cleaned up
            nova.subscriptions.add(client);
            this.languageClient = client;
        }
        catch (err) {
            // If the .start() method throws, it's likely because the path to the language server is invalid
            
            if (nova.inDevMode()) {
                console.error(err);
            }
        }
    }
    
    stop() {
        if (this.languageClient) {
            this.languageClient.stop();
            nova.subscriptions.remove(this.languageClient);
            this.languageClient = null;
        }
    }
}

