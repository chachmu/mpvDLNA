// mpvDLNA 1.0.0

"use strict";

mp.module_paths.push(mp.get_script_directory() + "\\modules.js");
var Options = require('Options');
var SelectionMenu = require('SelectionMenu');
mp.module_paths.pop();


var DLNA_Node = function(name, id) {
    this.name = name;
    this.id = id;
    this.url = null;
    this.children = null;
    
    this.isPlaying = false;
    this.type = "node";
};


var DLNA_Server = function(name, url) {
    this.name = name;
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

    // List of nodes added to playlist. Should mirror the MPV internal playlist.
    // This is necessary because in certain edge cases if a user were to be playing
    // an episode while browsing with the DLNA browser and left the folder that the 
    // current episodes were in then we wouldn't be able to figure out where the 
    // now playing indicator should be
    this.playlist = [];
    this.playingUrl = null;

    // Typing functionality    
    this.typing_controls = {
        "ESC" : function(){ mp.msg.error("exit") },
        "ENTER" : function(){ mp.msg.error("trigger") }
    };
    
    this.typing_keys = [];
    for (var i = 33; i <= 126; i++) {
        this.typing_keys.push(String.fromCharCode(i));
    }
    
    this.typing_active = false;
    this.typing_position = 0;
    this.typing_text = "";
};


DLNA_Browser.prototype.findDLNAServers = function() {
    mp.msg.info("scanning for dlna servers");
    
    // Increase the timeout if you have trouble finding a DLNA server that you know is working
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

DLNA_Browser.prototype.toggle_typing = function() {
    
    if (!this.typing_active) {
        mp.osd_message("typing active", 10);
        
        Object.keys(this.typing_controls).forEach( function(key) {
            //for key, func in pairs(typerControls) do
            mp.msg.error("key: "+key);
            mp.msg.error(this.typing_controls) // This breaks for some reason. Maybe its not declared correctly. Look at how SelectionMenu.js does it
            mp.add_forced_key_binding(key, "typing_"+key, this.typing_controls[key], {repeatable:true})
        });
        /*
        for i, key in ipairs(typerKeys) do
            mp.add_forced_key_binding(key, "typer"..key, function() typer(key) end, {repeatable=true})
        end
        */
        
        this.typing_text = "";
        this.typing_position = 0;
        this.typing_active = true;
        
    } else {
        this.typing_active=false;
    }
};



// This function adds the previous and next episodes to the playlist,
// changes the window title to the current episode title, and 
// updates the now playing indicator
DLNA_Browser.prototype.on_file_load = function() {
    
    // DLNA isn't being used
    if (this.playlist.length == 0) {
        return;
    }


    var p_index = mp.get_property_number("playlist-playing-pos", 1);       
    var playlist = mp.get_property_native("playlist", {});
    
    var episode_number = null
    for (var i = 0; i < this.playlist.length; i++) {
        if (this.playlist[i].url == playlist[p_index].filename) {
            episode_number = i;
            break;
        }
    };
    
    if (episode_number === null) {
        mp.msg.warn("The DLNA playlist is not properly synced with the internal MPV playlist");
        return
    }
    
    var episode = this.playlist[episode_number];
    var folder = episode.folder.children; // The code below is very confusing if you forget that folder != episode.folder
    
    
    // Update the now playing indicator and rerender the menu if necessary
    folder[episode.id].isPlaying = true;
    if (this.menu.isMenuActive()) {
        this.menu.renderMenu();
    }
    
    // Set the title to match the current episode
    mp.set_property("force-media-title", episode.folder.name + ":   " + folder[episode.id].name);
    this.playingUrl = episode.url;
    
    
    // If there is a previous episode
    if (episode.id - 1 >= 0) {
        // and the playlist entry before this one either doesn't exist or isn't the previous episode
        if (p_index-1 < 0 || playlist[p_index-1].filename != folder[episode.id-1].url) {
            var prev = folder[episode.id-1];
            mp.commandv("loadfile", prev.url, "append");
            
            // Move the last element in the list (the one we just appended) to in front of the current episode
            mp.commandv("playlist-move", playlist.length, p_index);
            
            this.playlist.push({ folder: episode.folder,
                                     id: episode.id-1,
                                    url: prev.url
            });
        }
    }
    
    // If there is a next episode
    if (episode.id + 1 < folder.length) {
        // and the playlist entry after this one either doesn't exist or isn't the next episode
        if (p_index+1 >= playlist.length || playlist[p_index+1].filename != folder[episode.id+1].url) {
            var next = folder[episode.id+1];
            mp.commandv("loadfile", next.url, "append");
            
            // Move the last element in the list (the one we just appended) to behind the current episode
            mp.commandv("playlist-move", playlist.length, p_index+1);
            
            this.playlist.push({ folder: episode.folder,
                                     id: episode.id+1,
                                    url: next.url
            });
        }
    }
};

// Removes the now playing indicator
DLNA_Browser.prototype.on_file_end = function() {
    // DLNA isn't being used
    if (this.playlist.length == 0) {
        return;
    }

    for (var i = 0; i < this.playlist.length; i++) {
        if (this.playlist[i].url == this.playingUrl) {
            var episode = this.playlist[i];
            episode.folder.children[episode.id].isPlaying = false;
            break;
        }
    };

};


DLNA_Browser.prototype.generateMenuTitle = function() {
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
                self.parents = [selection];
                self.titles = [];
            } else if (selection.type == "node") {
                if (selection.url === null) {
                    self.parents.push(selection)
                } else {
                    mp.msg.info("Loading " + selection.name + ": " + selection.url);
                    mp.commandv("loadfile", selection.url, "replace");
                    
                    // Clear the DLNA playlist of playing indicators and replace it with the new playlist
                    self.playlist.forEach(function(episode){episode.folder.children[episode.id].isPlaying = false});   
                    self.playlist = [{folder: self.parents[self.parents.length-1],
                                          id: this.selectionIdx,
                                         url: selection.url
                    }];
                    
                    this.hideMenu();
                    return;
                }  
            } else {
                // This should never happen
                return
            }


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
            
            // If the selection has no children then don't bother moving to it
            if (self.parents[self.parents.length-1].children.length == 0) {
                self.parents.pop();
            } else {
                // Update the title and menu to the new selection
                self.titles.push(selection.name);
                self.generateMenuTitle();
                
                self.menu.setOptions(self.parents[self.parents.length-1].children, 0);
            }
            
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
                self.generateMenuTitle(self.titles[self.titles.length-1]);
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
    
    mp.add_key_binding(null, 'type_mpvDLNA', function(){
        browser.toggle_typing();
    })

    // Handle necessary changes when loading the next file
    // such as adding the next and previous episodes to the playlist
    // and updating the window title to match the episode title
    mp.register_event("file-loaded", function() {
        browser.on_file_load();
    });
    
    // Handle necessary changes when ending the current file
    // such as marking it as no longer playing
    mp.register_event("end-file", function() {
        browser.on_file_end();
    });
})();
