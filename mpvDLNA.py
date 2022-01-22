import sys
import upnpclient

from lxml import etree

# Try to import wake on lan
wol = True
try:
    import wakeonlan
except ImportError as error:
    wol = False

import logging
# important information is passed through stdout so we need to supress
# the output of the upnp client module
logging.getLogger("upnpclient").setLevel(logging.CRITICAL)
logging.getLogger("ssdp").setLevel(logging.CRITICAL)

def wake(mac):
    if wol:
        try:
            wakeonlan.send_magic_packet(mac);
            print("packet sent")
        except:
            print("send failed")
    else:
        print("import failed")

def info(url, id, count):
    device = upnpclient.Device(url)
    result = device.ContentDirectory.Browse(ObjectID=id, BrowseFlag="BrowseMetadata", Filter="*", StartingIndex=0, RequestedCount=count, SortCriteria="")
    root = etree.fromstring(result["Result"])

    # Determine if we should be looking at items or containers
    list = root.findall("./item", root.nsmap)
    type = "item"
    if len(list) == 0:
        list = root.findall("./container", root.nsmap)
        type = "container"

    print(type)
    for t in list:
        print("")
        print(t.findtext("upnp:episodeNumber", "No Episode Number", root.nsmap))
        print(t.findtext("dc:description", "No Description", root.nsmap).encode().decode("ascii", errors='ignore'))


def browse(url, id, count):
    device = upnpclient.Device(url)
    result = device.ContentDirectory.Browse(ObjectID=id, BrowseFlag="BrowseDirectChildren", Filter="*", StartingIndex=0, RequestedCount=count, SortCriteria="")
    root = etree.fromstring(result["Result"])

    list = {}

    # Determine if we should be looking at items or containers
    list["item"] = root.findall("./item", root.nsmap)
    list["container"] = root.findall("./container", root.nsmap)

    for type in list.keys():
        print(type + "s:")
        for t in list[type]:
            print("")
            print(t.findtext("dc:title", "untitled", root.nsmap).encode().decode("ascii", errors='ignore'))
            print(t.get("id"))

            if type == "item":
                print(t.findtext("res", "", root.nsmap))
        print("----")


def list(timeout):
    devices = []

    possibleDevices = upnpclient.discover(timeout)
    for device in possibleDevices:
        if "MediaServer" in device.device_type:
            addToList = True
            for d in devices:
                if d.friendly_name == device.friendly_name:
                    addToList = False
                    break

            if addToList:
                devices.append(device)


    for device in devices:
        print("")
        print(device.friendly_name.encode().decode("ascii", errors='ignore'))
        print(device.location)


def help():
    print("mpvDLNA.py supports the following commands:")
    print("-h, --help     Prints the help dialog")
    print("-v, --version  Prints version information")
    print("-l, --list     Takes a timeout in seconds and outputs a list of DLNA Media Servers on the network")
    print("-b, --browse   Takes a DLNA url and the id of a DLNA element and outputs its direct children")
    print("-i, --info     Takes a DLNA url and the id of a DLNA element and outputs its metadata")
    print("-w, --wake     Takes a MAC address and attempts to send a wake on lan packet to it")


if len(sys.argv) == 2:
    if sys.argv[1] == "-v" or sys.argv[1] == "--version":
        print("mpvDLNA.py Plugin Version 2.0.0")
    else:
        help()
elif len(sys.argv) == 3:
    if sys.argv[1] == "-l" or sys.argv[1] == "--list":
        list(int(sys.argv[2]))
    elif sys.argv[1] == "-w" or sys.argv[1] == "--wake":
        wake(sys.argv[2])
    else:
        help()
elif len(sys.argv) >= 4:
    count = 2000
    if len(sys.argv) == 5:
        count = sys.argv[4]

    if sys.argv[1] == "-b" or sys.argv[1] == "--browse":
        browse(sys.argv[2], sys.argv[3], count)
    elif sys.argv[1] == "-i" or sys.argv[1] == "--info":
        info(sys.argv[2], sys.argv[3], count)
    else:
        help()
else:
    help()