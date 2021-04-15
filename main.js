// mpvDLNA 1.1.0

"use strict";

mp.module_paths.push(mp.get_script_directory() + "\\modules.js");
var Options = require('Options');
var Ass = require('AssFormat');
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

    this.current_folder = [];

    // List of nodes added to playlist. Should mirror the MPV internal playlist.
    // This is necessary because in certain edge cases if a user were to be playing
    // an episode while browsing with the DLNA browser and left the folder that the
    // current episodes were in then we wouldn't be able to figure out where the
    // now playing indicator should be
    this.playlist = [];
    this.playingUrl = null;


    // Typing functionality
    this.typing_controls = {
        "ESC"   : function(self){ self.toggle_typing() },
        "ENTER" : function(self){ self.typing_parse() },
        "LEFT"  : function(self){ self.typing_action("left") },
        "RIGHT" : function(self){ self.typing_action("right") },
        //"DOWN"  : function(self){ mp.msg.error("down") },//Might leave these unbound since they are
        //"UP"    : function(self){ mp.msg.error("up") },  //part of the menu navigation
        "BS"    : function(self){ self.typing_action("backspace") },
        "DEL"   : function(self){ self.typing_action("delete") },
        "SPACE" : function(self){ self.typing_action(" ") },
        "TAB"   : function(self){ self.typing_action("TAB") }
    };

    this.typing_keys = [];
    for (var i = 33; i <= 126; i++) {
         this.typing_keys.push(String.fromCharCode(i));
    }

    this.typing_mode = "text";

    this.typing_active = false;
    this.typing_position = 0;
    this.typing_text = "";
    this.autocomplete = [];
    this.selected_auto = {id: 0, full: ""};

    this.commands = {
        "scan" : { func: function(self){ self.menu.showMessage("Scanning");
                                         self.findDLNAServers();
                                         self.menu.showMessage("Scan Complete"); },
                   args: [],
                   text: false},

        "cd"   : { func: function(self, file) { self.command_cd(file); },
                   args: [],
                   text: true},

        "text" : { func: function(self, file){ self.typing_mode = "text";
                                               self.typing_text = "";
                                               self.typing_position = 0;
                                               self.typing_active = true;
                                               self.typing_action(""); },
                   args: [],
                   text: false}
    };
    this.command_list = Object.keys(this.commands);

    // String key of the current command
    this.command = null;
};


DLNA_Browser.prototype.findDLNAServers = function() {
    this.scan = false;
    this.menu.title = "Scanning for DLNA Servers";
    this.menu.renderMenu("", 1);


    mp.msg.info("scanning for dlna servers");
    this.servers = [];

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
    this.current_folder = this.servers;
    this.menu.setOptions(this.servers, 0);

    this.menu.renderMenu("", 1);
};


DLNA_Browser.prototype.toggle = function() {

    // Toggle the menu display state.
    if (this.menu.menuActive) {
        this.menu.hideMenu();
    } else {
        this.menu.showMenu();
        // Determine if we need to scan for DLNA servers
        if (this.scan) {
            this.menu.title = "Scanning for DLNA Servers";
            this.findDLNAServers();
        }
    }
};

// starts typing and sets mode to either "text" or "command"
DLNA_Browser.prototype.toggle_typing = function(mode) {

    if (!this.typing_active) {

        // if mode command is invalid just leave it on what it was before
        if (mode == "text" || mode == "command") {
            this.typing_mode = mode;
        }

        var self = this;
        Object.keys(this.typing_controls).forEach( function(key) {
            mp.add_forced_key_binding(key, "typing_"+key, function(){self.typing_controls[key](self)}, {repeatable:true})
        });

        this.typing_keys.forEach( function(key) {
            mp.add_forced_key_binding(key, "typing_"+key, function(){self.typing_action(key)}, {repeatable:true})
        });

        this.typing_text = "";
        this.typing_position = 0;
        this.typing_active = true;

        this.menu.showTyping();
        this.typing_action("");

    } else {
        this.typing_active=false;
        Object.keys(this.typing_controls).forEach( function(key) {
            mp.remove_key_binding("typing_"+key);
        });

        this.typing_keys.forEach( function(key) {
            mp.remove_key_binding("typing_"+key);
        });

        this.menu.hideTyping();
    }
};

DLNA_Browser.prototype.typing_action = function(key) {
    var tabbing = false;

    if (key.length == 1){
        // "\" does not play nicely with the formatting characters in the osd message
        if (key != "\\") {
            this.typing_text = this.typing_text.slice(0, this.typing_position)
                + key +  this.typing_text.slice(this.typing_position);
            this.typing_position+=1;
        }
    } else if (key == "backspace") {
        // can't backspace if at the start of the line
        if (this.typing_position) {
            this.typing_text = this.typing_text.slice(0, this.typing_position-1)
            + this.typing_text.slice(this.typing_position);

            this.typing_position-= 1;
        }

        if (this.typing_mode == "command" && this.command != null) {
            if (this.typing_position <= this.command.length) {
                this.command = null;
            }
        }

    } else if (key == "delete") {
        this.typing_text = this.typing_text.slice(0, this.typing_position)
            + this.typing_text.slice(this.typing_position+1);

        if (this.typing_mode == "command" && this.command != null) {
            if (this.typing_position <= this.command.length) {
                this.command = null;

                // Because we autoadd a space when completing a command and because
                // using delete means the cursor is not next to it, the space becomes
                // almost impossible to find. I wrote this code and still thought it
                // was a bug when the invisible space character supressed the autocorrect
                // Much easier for users to just not have to deal with it
                if (this.typing_text[this.typing_text.length-1] == " ") {
                    this.typing_text = this.typing_text.slice(0, -1);
                }
            }
        }

    } else if (key == "right") {
        this.typing_position += 1;
        if (this.typing_position > this.typing_text.length) {
            this.typing_position = 0;
        }

    } else if (key == "left") {
        this.typing_position -= 1;
        if (this.typing_position < 0) {
            this.typing_position = this.typing_text.length;
        }

    } else if (key == "TAB") {
        tabbing = true;
        this.selected_auto.id++;
        mp.msg.error("ac length: "+this.autocomplete.length);
        mp.msg.error("trying id: "+this.selected_auto.id);
        if (this.selected_auto.id >= this.autocomplete.length) {
            this.selected_auto.id = 0;
        }

        mp.msg.error("tab sees: ")
        for (var i = 0; i < this.autocomplete.length; i++) {
                mp.msg.error([i] + "-> " + this.autocomplete[i].full)
        }
        mp.msg.error("-----------------------------")

        if (this.autocomplete.length) {
            this.selected_auto.full = this.autocomplete[this.selected_auto.id].full;
            mp.msg.error("selected: "+this.selected_auto.full)
        }

    } else if (key == "clear"){
        this.typing_text = "";
        this.typing_position = 0;
        this.autocomplete = [];
        this.selected_auto = {id: 0, full: ""};

    }

    var message = "";
    message += Ass.white(true) + this.typing_text.slice(0, this.typing_position);
    message += Ass.yellow(true) + "|";
    message += Ass.white(true) + this.typing_text.slice(this.typing_position);

    // Use command mode autocorrect.
    if (this.typing_mode == "command") {

        // Look for a valid command
        if (this.command == null) {
            if (this.typing_text[this.typing_text.length-1] == " ") {
                var search = this.selected_auto.full;

                for (var i = 0; i < this.command_list.length; i++) {
                    if (this.command_list[i].toUpperCase() == search.toUpperCase()) {
                        this.command = this.command_list[i];
                        break;
                    }
                }

            // autocomplete the command
            } else {
                message = this.autocomplete_command(this.typing_text, message, tabbing);
            }
        }

        // Have a valid command, autocomplete the argument
        if (this.command){
            var argument = this.typing_text.slice(this.typing_text.split(" ")[0].length+1);
            var index = message.split(" ")[0].length+1;
            var msg = message.slice(index);
            message = message.slice(0, index) + this.autocomplete_text(argument, msg, tabbing);
        }

        message = "$ " + message;

    // Use text mode autocorrect.
    } else if (this.typing_mode == "text") {
        message = this.autocomplete_text(this.typing_text, message, tabbing);
    }

    message = Ass.startSeq(true) + message + Ass.stopSeq(true);
    this.menu.typingText = message;
    this.menu._renderActiveText();
};

// Try to find a valid command or folder
DLNA_Browser.prototype.typing_parse = function() {
    var success = false;

    // Planned Commands (more to come)
    //      search - Either query the DLNA server if thats possible or just manually search
    //      cd - exactly the same as what text mode does now
    //      play - this might be replaced with just trying to cd into a media file
    //      ep - find episode by number (maybe have option for absolute episode number instead of just its place in a season)
    //      pep - ep but starts playback
    //      info - query DLNA server for metadata
    //      text - switch to text input mode

    if (this.typing_mode == "command") {

        // This flag is used to make sure we don't accidentally autocomplete the command
        // and the arguments in a single enter keystroke
        var text_input = false;
        if (this.command == null) {
            text_input = true;
            if (this.autocomplete.length != 0) {
                this.command = this.selected_auto.full
                this.typing_text = this.selected_auto.full + " ";
                this.typing_position = this.typing_text.length;

                text_input = this.commands[this.command].text;
            }
        }

        if (this.command != null && !text_input) {
            var cmd = this.commands[this.command];

            if ( (!cmd.text && cmd.args.length == 0) || this.autocomplete.length != 0) {
                this.commands[this.command].func(this, this.selected_auto.full);
                success = true;
            }
        }

    } else if (this.typing_mode == "text") {
        success = this.command_cd(this.typing_text);
    }

    if (success) {
        this.command = null;
        this.typing_action("clear");
    } else {
        // Rescan for autocomplete
        this.typing_action("");
    }
};

DLNA_Browser.prototype.autocomplete_command = function(text, message, tabbing) {
    // find new autocomplete options only if we are actually typing
    if (!tabbing) {
        this.autocomplete = [];


        if (text == "" && this.selected_auto.full=="") {
            this.selected_auto = {id: null, full: ""};
            return message;
        }

        for (var i = 0; i < this.command_list.length; i++) {
            var index = this.command_list[i].toUpperCase().indexOf(text.toUpperCase());

            if (index != -1) {
                this.autocomplete.push({
                     pre:  this.command_list[i].slice(0, index),
                    post: this.command_list[i].slice(index + text.length),
                    full: this.command_list[i],
                  sindex: index,
                  findex: i
                });
            }
        }

        // Prefer the search term appearing as soon in the text as possible
        this.autocomplete.sort(function(a, b) {
            return a.sindex == b.sindex ? a.findex - b.findex : a.sindex-b.sindex;
        });
    }

    if (this.autocomplete.length > 0) {
        var search = this.selected_auto.full;
        // Prefer the earliest option in the list
        this.selected_auto = {
                     pre: this.autocomplete[0].pre,
                    post: this.autocomplete[0].post,
                    full: this.autocomplete[0].full,
                  sindex: this.autocomplete[0].sindex,
                  findex: this.autocomplete[0].findex,
                      id: 0
        }; // have to break this out or you get crazy referencing issues

        for (var i = 0; i < this.autocomplete.length; i++) {
            if (search == this.autocomplete[i].full) {
                this.selected_auto = {
                         pre: this.autocomplete[i].pre,
                        post: this.autocomplete[i].post,
                        full: this.autocomplete[i].full,
                      sindex: this.autocomplete[i].sindex,
                      findex: this.autocomplete[i].findex,
                          id: i
                }; // have to break this out or you get crazy referencing issues
                break;
            }
        }

        // Move the actively selected option to the front of the list so entries are
        // sorted by how close to the front of the string the search term is
        if (!tabbing) {
            this.autocomplete = [this.autocomplete[this.selected_auto.id]].concat(
                                this.autocomplete.slice(0,this.selected_auto.id),
                                this.autocomplete.slice(this.selected_auto.id+1));

            this.selected_auto = {
                         pre: this.autocomplete[0].pre,
                        post: this.autocomplete[0].post,
                        full: this.autocomplete[0].full,
                      sindex: this.autocomplete[0].sindex,
                      findex: this.autocomplete[0].findex,
                          id: 0
            }; // have to break this out or you get crazy referencing issues
        }

        message = Ass.alpha("DDDD6E") + this.selected_auto.pre
        + Ass.alpha("00") + message + Ass.alpha("DDDD6E") + this.selected_auto.post;
    } else {
        this.selected_auto = {id: 0, full: ""};
    }

    return message;
}

DLNA_Browser.prototype.autocomplete_text = function(text, message, tabbing) {

    // find new autocomplete options only if we are actually typing
    if (!tabbing) {
        this.autocomplete = [];

        // add ".." to the list of autocomplete options
        var options = this.current_folder.concat({name: ".."});

        for (var i = 0; i < options.length; i++) {
            var item = options[i];
            var index = item.name.toUpperCase().indexOf(text.toUpperCase());

            if ((item.children == null || item.children.length != 0) && index != -1) {
                this.autocomplete.push({
                     pre:  item.name.slice(0, index),
                    post: item.name.slice(index + text.length),
                    full: item.name,
                  sindex: index,
                  findex: i
                });
            }
        }

        // Prefer the search term appearing as soon in the text as possible
        this.autocomplete.sort(function(a, b) {
            return a.sindex == b.sindex ? a.findex - b.findex : a.sindex-b.sindex;
        });
    }

    if (this.autocomplete.length > 0) {
        var search = this.selected_auto.full;

        this.selected_auto = {
                     pre: this.autocomplete[0].pre,
                    post: this.autocomplete[0].post,
                    full: this.autocomplete[0].full,
                  sindex: this.autocomplete[0].sindex,
                  findex: this.autocomplete[0].findex,
                      id: 0
        }; // have to break this out or you get crazy referencing issues

        for (var i = 0; i < this.autocomplete.length; i++) {
            mp.msg.error([i] + "-> " + this.autocomplete[i].full)
        }

        for (var i = 0; i < this.autocomplete.length; i++) {
            if (search == this.autocomplete[i].full) {
                this.selected_auto = {
                             pre: this.autocomplete[i].pre,
                            post: this.autocomplete[i].post,
                            full: this.autocomplete[i].full,
                          sindex: this.autocomplete[i].sindex,
                          findex: this.autocomplete[i].findex,
                              id: i
                }; // have to break this out or you get crazy referencing issues

                break;


            }
        }

        // Move the actively selected option to the front of the list so entries are
        // sorted by how close to the front of the string the search term is
        if (!tabbing) {
            this.autocomplete = [this.autocomplete[this.selected_auto.id]].concat(
                                this.autocomplete.slice(0,this.selected_auto.id),
                                this.autocomplete.slice(this.selected_auto.id+1));

            this.selected_auto = {
                         pre: this.autocomplete[0].pre,
                        post: this.autocomplete[0].post,
                        full: this.autocomplete[0].full,
                      sindex: this.autocomplete[0].sindex,
                      findex: this.autocomplete[0].findex,
                          id: 0
            }; // have to break this out or you get crazy referencing issues
        }

        // Update the menu selection to match
        this.menu.selectionIdx = this.selected_auto.findex;
        this.menu.renderMenu("", 1);

        message = Ass.alpha("DDDD6E") + this.selected_auto.pre
        + Ass.alpha("00") + message + Ass.alpha("DDDD6E") + this.selected_auto.post;
    } else {
        this.selected_auto = {id: 0, full: ""};
    }

    return message;
}


DLNA_Browser.prototype.command_cd = function(text) {
    var success = false;
    if(text == "..") {
        this.back();
        success = true;
    }else {
        var search = text;
        if (this.autocomplete.length != 0) {
            search = this.selected_auto.full;
        }

        for (var i = 0; i < this.current_folder.length; i++) {
            var item = this.current_folder[i];

            if (search == item.name) {
                success = this.select(item);
            }
        }
    }

    return success
}



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


DLNA_Browser.prototype.select = function(selection) {
    if (!selection)
        return false;

    if (selection.type == "server") {
        this.parents = [selection];
        this.titles = [];
    } else if (selection.type == "node") {
        if (selection.url === null) {
            this.parents.push(selection)
        } else {
            mp.msg.info("Loading " + selection.name + ": " + selection.url);
            mp.commandv("loadfile", selection.url, "replace");

            // Clear the DLNA playlist of playing indicators and replace it with the new playlist
            this.playlist.forEach(function(episode){episode.folder.children[episode.id].isPlaying = false});
            this.playlist = [{folder: this.parents[this.parents.length-1],
                                  id: this.parents[this.parents.length-1].children.indexOf(selection),
                                 url: selection.url
            }];

            this.menu.hideMenu();
            if (this.typing_active) {
                this.toggle_typing();
            }

            return true;
        }
    } else {
        // This should never happen
        return false;
    }


    // This node has not been loaded before, fetch its children
    if (this.parents[this.parents.length-1].children === null) {
        var result = mp.command_native({
            name: "subprocess",
            playback_only: false,
            capture_stdout: true,
            args : ["python", mp.get_script_directory()+"\\mpvDLNA.py", "-b", this.parents[0].url, selection.id]
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
        this.parents[this.parents.length-1].children = children;
    }

    var success = false;

    // If the selection has no children then don't bother moving to it
    if (this.parents[this.parents.length-1].children.length == 0) {
        this.parents.pop();
    } else {
        // Update the title and menu to the new selection
        this.titles.push(selection.name);
        this.generateMenuTitle();

        this.current_folder = this.parents[this.parents.length-1].children;
        this.menu.setOptions(this.parents[this.parents.length-1].children, 0);
        success = true;
    }

    this.menu.renderMenu("", 1);
    return success;
}

DLNA_Browser.prototype.back = function() {
    this.parents.pop();
    this.titles.pop();

    if (this.parents.length == 0) {
        this.menu.setOptions(this.servers, 0);
        this.menu.title = "Servers";
    } else {
        this.current_folder = this.parents[this.parents.length-1].children;
        this.menu.setOptions(this.parents[this.parents.length-1].children, 0);
        this.generateMenuTitle(this.titles[this.titles.length-1]);
    }

    this.menu.renderMenu("", 1);
}

DLNA_Browser.prototype._registerCallbacks = function() {

    var self = this; // Inside the callbacks this will end up referring to menu instead of DLNA_Browser

    this.menu.setCallbackMenuOpen(function() {
         self.select(this.getSelectedItem());
    });


    this.menu.setCallbackMenuLeft(function() {
        self.back();
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

    mp.add_key_binding(null, 'text_mpvDLNA', function(){
        browser.toggle_typing("text");
    })

    mp.add_key_binding(null, 'command_mpvDLNA', function(){
        browser.toggle_typing("command");
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
