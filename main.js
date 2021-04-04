"use strict";

mp.module_paths.push(mp.get_script_directory() + "\\modules.js");
var Options = require('Options');
var SelectionMenu = require('SelectionMenu');


var DLNA_Node = function(name, id) {
    this.menuText = name;
    this.id = id;
    this.url = null;
    this.children = null;

    this.type = "node";
};


var DLNA_Server = function(name, url) {
    this.menuText = name;
    this.id = "0"
    this.url = url;
    this.children = null;
    
    this.type = "server"
};



// Class to browse DLNA servers
var DLNA_Browser = function(options) {
    
    options = options || {};
    
    // --------------------------
    
    this.showHelpHint = typeof options.showHelpHint === 'boolean' ?
        options.showHelpHint : true;

    this.menu = new SelectionMenu({ // Throws if bindings are illegal.
            maxLines: options.maxLines,
            menuFontSize: options.menuFontSize,
            autoCloseDelay: options.autoCloseDelay,
            keyRebindings: options.keyRebindings
    });
    this.menu.setMetadata({type:null});
    
    this._registerCallbacks();
    
    var self = this;
    
    // Only use menu text colors while mpv is rendering in GUI mode (non-CLI).
    this.menu.setUseTextColors(mp.get_property_bool('vo-configured'));
    mp.observe_property('vo-configured', 'bool', function(name, value) {
        self.menu.setUseTextColors(value);
    });  
    
    // determine if we need to scan for DLNA servers next time the browser opens
    this.scan = true;
    this.servers = [];
    
    // list of the parents of the current node. 
    // The first element represents the server we are currently browsing
    // The last element represents the node we are currently on
    this.parents = [];
    
    // List of titles to combine to get the title of the menu
    this.titles = [];
};


DLNA_Browser.prototype.findDLNAServers = function() {
    mp.msg.error("scanning dlna servers");
    
    // increase the timeout if you have trouble finding a DLNA server that you know is working
    var result = mp.command_native({
        name: "subprocess",
        playback_only: false,
        capture_stdout: true,
        args : ["python", mp.get_script_directory()+"\\mpvDLNA.py", "-l", "1"]
    });

    var sp = result.stdout.split("\n");
    
    // The first element of sp is not useful here
    for (var i = 1; i < sp.length; i=i+3) {
        // Need to remove the trailing \n from each entry 
        var server = new DLNA_Server(sp[i].slice(0, -1), sp[i+1].slice(0, -1));
        this.servers.push(server);
    }
    this.menu.title = "Servers";
    this.menu.setOptions(this.servers, 0);
};


DLNA_Browser.prototype.toggle = function() {
    
    // Determine if we need to scan for DLNA servers
    if (this.scan) {
        mp.osd_message("Scanning for DLNA Servers", 10);
        this.findDLNAServers();
        this.scan = false;
    }
    
    // Toggle the menu display state.
    if (this.menu.isMenuActive())
        this.menu.hideMenu();
    else {
        this.menu.renderMenu();
        this.menu._showMenu();
    }
};


// This function adds the previous and next episodes to the playlist
DLNA_Browser.prototype.add_surrounding_files = function() {
    
    var episodes = this.parents[this.parents.length-1].children;    
    var p_index = mp.get_property_number("playlist-playing-pos", 1);       
    var playlist = mp.get_property_native("playlist", {});
    
    var episode_number = null;
    for (var i = 0; i < episodes.length; i++) {
        if (episodes[i].url == playlist[p_index].filename) {
            episode_number = i;
            break;
        }
    };
    
    if (episode_number === null) {
        // The playlist wasn't set up with DLNA browser so we shouldn't modify it
        return
    }

    // If there is a previous episode
    if (episode_number - 1 >= 0) {
        // and the playlist entry before this one either doesn't exist or isn't the previous episode
        if (p_index-1 < 0 || playlist[p_index-1].filename != episodes[episode_number-1].url) {
            var prev = episodes[episode_number-1].url
            mp.commandv("loadfile", prev, "append");
            // Move the last element in the list (the one we just appended) to in front of the current episode
            mp.commandv("playlist-move", playlist.length, p_index);
        } else {
            mp.msg.error("PREVIOUS FILE ALREADY LOADED");
        }

    } else {
        mp.msg.error("No prev episode");
    }
    
    // If there is a next episode
    if (episode_number + 1 < episodes.length) {
        // and the playlist entry after this one either doesn't exist or isn't the next episode
        if (p_index+1 >= playlist.length || playlist[p_index+1].filename != episodes[episode_number+1].url) {
            var next = episodes[episode_number+1].url
            mp.commandv("loadfile", next, "append");
            // Move the last element in the list (the one we just appended) to behind the current episode
            mp.commandv("playlist-move", playlist.length, p_index+1);
        } else {
            mp.msg.error("NEXT FILE ALREADY LOADED");
        }
    } else {
        mp.msg.error("No next episode")
    }

};

DLNA_Browser.prototype.generateTitle = function() {
    this.menu.title=this.titles[this.titles.length-1];

    // Already have the first element
    for (var i = this.titles.length-2; i >= 0; i-- ) {
        // Condense repeat menu titles by only using the more specific one
        if (this.titles[i+1].indexOf(this.titles[i]) == -1) {
            this.menu.title = this.titles[i] + " / " + this.menu.title;
            
            if (this.menu.title.length > 90) {
                this.menu.title = this.menu.title.slice(this.titles[i].length + 3, this.menu.title.length);
                break;
            }
        }
    }
};

DLNA_Browser.prototype._registerCallbacks = function() {
    
    var self = this; // Inside the callbacks this will end up referring to menu instead of DLNA_Browser
    
    this.menu.setCallbackMenuOpen(function() {
            var selection = self.menu.getSelectedItem();
            if (!selection)
                return;
            
            if (selection.type == "server") {
                mp.msg.error("selected a server");
                self.parents = [selection];
                self.titles = [];
            } else if (selection.type == "node") {
                if (selection.url === null) {
                    mp.msg.error("selected a container node");
                    self.parents.push(selection)
                } else {
                    mp.msg.error("selected an item node")
                    mp.msg.error(selection.menuText + "  :  " + selection.url);
                    
                    self.current_index = this.selectionIdx;
                    mp.commandv("loadfile", selection.url, "replace");
                    this.hideMenu();
                    return;
                }  
            } else {
                // This should never happen
                mp.msg.error("someone messed up");
            }
            
            self.titles.push(selection.menuText);
            self.generateTitle();


            // This node has not been loaded before, fetch its children
            if (self.parents[self.parents.length-1].children === null) {
                var result = mp.command_native({
                    name: "subprocess",
                    playback_only: false,
                    capture_stdout: true,
                    args : ["python", mp.get_script_directory()+"\\mpvDLNA.py", "-b", self.parents[0].url, selection.id]
                });
                
                var sp = result.stdout.split("\n");
                
                // Tells us if we are getting item or container type data
                var is_item = sp[0].slice(0, -1)=="item";
                var increase = (is_item ? 4 : 3);
                var max_length = (is_item ? 1 : 2)
                
                var children = [];
                
                // The first 2 elements of sp are not useful here
                for (var i = 2; i+max_length < sp.length; i=i+increase) {
                    
                    // Need to remove the trailing \n from each entry 
                    var child = new DLNA_Node(sp[i].slice(0, -1), sp[i+1].slice(0, -1));
                    
                    if (is_item) {
                        child.url = sp[i+2].slice(0,-1);
                    }
                    
                    children.push(child);
                }
                self.parents[self.parents.length-1].children = children;
            }
                       
            self.menu.setOptions(self.parents[self.parents.length-1].children, 0);
            self.menu.renderMenu();
        });
        
        
        this.menu.setCallbackMenuLeft(function() {
            self.parents.pop();
            self.titles.pop();
            
            if (self.parents.length == 0) {
                self.menu.setOptions(self.servers, 0);
                self.menu.title = "Servers";
            } else {
                self.menu.setOptions(self.parents[self.parents.length-1].children, 0);
                self.generateTitle(self.titles[self.titles.length-1]);
            }
            
            self.menu.renderMenu();
        });
};



(function() {
    // Read user configuration (uses defaults for any unconfigured options).
    // * You can override these values via the configuration system, as follows:
    // - Via permanent file: `<mpv config dir>/script-settings/Blackbox.conf`
    // - Command override: `mpv --script-opts=Blackbox-favorites="{/path1}+{/path2}"`
    // - Or by editing this file directly (not recommended, makes your updates harder).
    var userConfig = new Options.advanced_options({
        // How long to keep the menu open while you are idle.
        // * (float/int) Ex: `10` (ten seconds), `0` (to disable autoclose).
        auto_close: 0,
        // Maximum number of file selection lines to show at a time.
        // * (int) Ex: `20` (twenty lines). Cannot be lower than 3.
        max_lines: 10,
        // What font size to use for the menu text. Large sizes look the best.
        // * (int) Ex: `42` (font size fourtytwo). Cannot be lower than 1.
        font_size: 40,
        // Whether to show the "[h for help]" hint on the first launch.
        // * (bool) Ex: `yes` (enable) or `no` (disable).
        help_hint: true,
        // Keybindings. You can bind any action to multiple keys simultaneously.
        // * (string) Ex: `{up}`, `{up}+{shift+w}` or `{x}+{+}` (binds to "x" and the plus key).
        // - Note that all "shift variants" MUST be specified as "shift+<key>".
        'keys_menu_up': '{up}',
        'keys_menu_down': '{down}',
        'keys_menu_up_fast': '{shift+up}',
        'keys_menu_down_fast': '{shift+down}',
        'keys_menu_left': '{left}',
        'keys_menu_right': '{right}',
        'keys_menu_open': '{enter}',
        'keys_menu_undo': '{bs}',
        'keys_menu_help': '{h}',
        'keys_menu_close': '{esc}'
    });

    // Create and initialize the media browser instance.
    try {
        var browser = new DLNA_Browser({ // Throws.
            autoCloseDelay: userConfig.getValue('auto_close'),
            maxLines: userConfig.getValue('max_lines'),
            menuFontSize: userConfig.getValue('font_size'),
            showHelpHint: userConfig.getValue('help_hint'),
            keyRebindings: {
                'Menu-Up': userConfig.getMultiValue('keys_menu_up'),
                'Menu-Down': userConfig.getMultiValue('keys_menu_down'),
                'Menu-Up-Fast': userConfig.getMultiValue('keys_menu_up_fast'),
                'Menu-Down-Fast': userConfig.getMultiValue('keys_menu_down_fast'),
                'Menu-Left': userConfig.getMultiValue('keys_menu_left'),
                'Menu-Right': userConfig.getMultiValue('keys_menu_right'),
                'Menu-Open': userConfig.getMultiValue('keys_menu_open'),
                'Menu-Undo': userConfig.getMultiValue('keys_menu_undo'),
                'Menu-Help': userConfig.getMultiValue('keys_menu_help'),
                'Menu-Close': userConfig.getMultiValue('keys_menu_close')
            }
        });
    } catch (e) {
        mp.msg.error('DLNA: '+e+'.');
        mp.osd_message('DLNA: '+e.stack+'.', 30);
        throw e; // Critical init error. Stop script execution.
    }

    // Provide the bindable mpv command which opens/cycles through the menu.
    // * Bind this via input.conf: `ctrl+b script-binding Blackbox`.
    // - To get to your favorites (if you've added some), press this key twice.
    mp.add_key_binding(null, 'toggle_mpvDLNA', function() {
        browser.toggle();
    });

    // add the next and previous episode to the playlist
    mp.register_event("file-loaded", function() {
        browser.add_surrounding_files();
    });
})();
