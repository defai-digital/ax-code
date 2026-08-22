pub fn greet(name: &str) -> String {
    format!("hello {name}")
}

pub fn shout(text: &str) -> String {
    text.to_uppercase()
}
